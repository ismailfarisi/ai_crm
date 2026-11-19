import { Injectable } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import * as nodemailer from 'nodemailer';
import { ChannelCryptoService } from '@/modules/channels/services/channel-crypto.service';
import { EmailAccount } from '../entities/email-account.entity';
import type { ComposeInput } from '../gmail/mime';
import { parseRaw } from './imap-mime';

const IMAP_HOST = 'imap.gmail.com';
const SMTP_HOST = 'smtp.gmail.com';

/** Stored encrypted on the account row — a Gmail app password, not OAuth. */
export interface ImapCredentials {
  username: string;
  appPassword: string;
}

/** Login was rejected — the app password is wrong, revoked or disabled. */
export class ImapAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImapAuthError';
  }
}

export interface ImapMailbox {
  /** Mailbox path as the server names it, e.g. `INBOX`, `[Gmail]/Sent Mail`. */
  path: string;
  specialUse?: string;
  uidValidity: bigint;
  exists: number;
}

/**
 * IMAP/SMTP transport for mailboxes connected with a Gmail app password.
 * Gmail hosts are fixed deliberately — this provider exists for "connect your
 * Gmail account" on domains where OAuth is not available; generic IMAP hosts
 * can be added later without changing anything upstream.
 */
@Injectable()
export class ImapClientService {
  constructor(private readonly crypto: ChannelCryptoService) {}

  readCredentials(account: EmailAccount): ImapCredentials | null {
    if (!account.encryptedCredentials) return null;
    try {
      return this.crypto.decrypt<ImapCredentials>(account.encryptedCredentials);
    } catch {
      return null;
    }
  }

  writeCredentials(creds: ImapCredentials): string {
    return this.crypto.encrypt(creds);
  }

  /** Open + login. Throws ImapAuthError when Google rejects the password. */
  async connect(account: EmailAccount): Promise<ImapFlow> {
    const creds = this.readCredentials(account);
    if (!creds?.username || !creds.appPassword) {
      throw new ImapAuthError(
        'Stored credentials are missing — reconnect the account',
      );
    }
    const client = this.clientFor(creds);
    try {
      await client.connect();
    } catch (err) {
      await client.logout().catch(() => undefined);
      throw this.asAuthError(err);
    }
    return client;
  }

  /** Used by the connect form — verifies before anything is stored. */
  async verifyCredentials(
    emailAddress: string,
    appPassword: string,
  ): Promise<void> {
    const client = this.clientFor({
      username: emailAddress,
      appPassword,
    });
    try {
      await client.connect();
      await client.logout();
    } catch (err) {
      await client.logout().catch(() => undefined);
      throw this.asAuthError(err);
    }
  }

  /**
   * Mailboxes mapped by special-use flag. INBOX always exists; the rest are
   * optional — Gmail names them per locale (`[Gmail]/...`), so match on the
   * flag, never the path.
   */
  async listMailboxes(client: ImapFlow): Promise<ImapMailbox[]> {
    const boxes = await client.list();
    const out: ImapMailbox[] = [];
    for (const box of boxes) {
      if (!box.listed || !box.subscribed) continue;
      const opened = await client.status(box.path, {
        uidValidity: true,
        messages: true,
      });
      if (!opened) continue;
      out.push({
        path: box.path,
        specialUse: box.specialUse,
        uidValidity: opened.uidValidity ?? 0n,
        exists: opened.messages ?? 0,
      });
    }
    return out;
  }

  /** Raw RFC822 for one message — ingest and attachment download share it. */
  async fetchRaw(
    client: ImapFlow,
    mailbox: string,
    uid: number,
  ): Promise<Buffer | null> {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const msg = await client.fetchOne(
        String(uid),
        { source: true },
        { uid: true },
      );
      if (!msg || typeof msg !== 'object' || !msg.source) return null;
      return Buffer.from(msg.source);
    } finally {
      lock.release();
    }
  }

  /**
   * Sends through Gmail's SMTP — Gmail files the copy into Sent itself, so
   * the next sync picks it up and dedupes it against the optimistic row.
   */
  async send(
    account: EmailAccount,
    input: ComposeInput,
  ): Promise<{ messageId: string }> {
    const creds = this.readCredentials(account);
    if (!creds?.username || !creds.appPassword) {
      throw new ImapAuthError(
        'Stored credentials are missing — reconnect the account',
      );
    }
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: 465,
      secure: true,
      auth: { user: creds.username, pass: creds.appPassword },
    });
    try {
      const info = await transporter.sendMail({
        from: input.fromName
          ? { name: input.fromName, address: input.fromEmail }
          : input.fromEmail,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        text: input.bodyText,
        html: input.bodyHtml,
        inReplyTo: input.inReplyTo ?? undefined,
        references: input.references,
      });
      return { messageId: info.messageId ?? '' };
    } catch (err) {
      throw this.asAuthError(err);
    }
  }

  /**
   * Applies a thread patch upstream: read/starred are flags, folder changes
   * are moves between mailboxes resolved by special-use (\Trash, \Junk,
   * \All). Best-effort — the next poll reconciles regardless.
   */
  async applyPatch(
    account: EmailAccount,
    providerMessageId: string,
    patch: { isRead?: boolean; isStarred?: boolean; folder?: string },
  ): Promise<void> {
    const parsed = this.splitProviderId(providerMessageId);
    if (!parsed) return;
    const client = await this.connect(account);
    try {
      if (patch.isRead !== undefined || patch.isStarred !== undefined) {
        const lock = await client.getMailboxLock(parsed.mailbox);
        try {
          if (patch.isRead === true)
            await client.messageFlagsAdd(String(parsed.uid), ['\\Seen'], {
              uid: true,
            });
          if (patch.isRead === false)
            await client.messageFlagsRemove(String(parsed.uid), ['\\Seen'], {
              uid: true,
            });
          if (patch.isStarred === true)
            await client.messageFlagsAdd(String(parsed.uid), ['\\Flagged'], {
              uid: true,
            });
          if (patch.isStarred === false)
            await client.messageFlagsRemove(String(parsed.uid), ['\\Flagged'], {
              uid: true,
            });
        } finally {
          lock.release();
        }
      }
      if (patch.folder) {
        const destination =
          patch.folder === 'INBOX'
            ? 'INBOX'
            : await this.folderFor(client, patch.folder);
        if (destination && destination !== parsed.mailbox) {
          const lock = await client.getMailboxLock(parsed.mailbox);
          try {
            await client.messageMove(String(parsed.uid), destination, {
              uid: true,
            });
          } finally {
            lock.release();
          }
        }
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  /** Maps a workspace folder name to the mailbox owning that special-use. */
  private async folderFor(
    client: ImapFlow,
    folder: string,
  ): Promise<string | undefined> {
    const wanted =
      folder === 'TRASH' ? '\\Trash' : folder === 'SPAM' ? '\\Junk' : '\\All';
    const boxes = await client.list();
    return boxes.find((b) => b.specialUse === wanted)?.path;
  }

  /**
   * Attachment locator is `mailbox:uid:index` — the raw part is re-fetched
   * and re-parsed on demand so nothing is stored locally.
   */
  async fetchAttachment(
    account: EmailAccount,
    providerAttachmentId: string,
  ): Promise<{ data: Buffer } | null> {
    const idx = providerAttachmentId.lastIndexOf(':');
    if (idx < 0) return null;
    const attachmentIndex = Number(providerAttachmentId.slice(idx + 1));
    const parsed = this.splitProviderId(providerAttachmentId.slice(0, idx));
    if (!parsed || !Number.isInteger(attachmentIndex)) return null;

    const client = await this.connect(account);
    try {
      const raw = await this.fetchRaw(client, parsed.mailbox, parsed.uid);
      if (!raw) return null;
      const message = await parseRaw(raw);
      const content = message.attachments[attachmentIndex]?.content;
      if (content === undefined) return null;
      const data =
        typeof content === 'string'
          ? Buffer.from(content)
          : Buffer.from(
              content instanceof ArrayBuffer
                ? new Uint8Array(content)
                : content,
            );
      return { data };
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  /** `INBOX:42` → { mailbox: 'INBOX', uid: 42 } — ids embed their folder. */
  splitProviderId(
    providerMessageId: string,
  ): { mailbox: string; uid: number } | null {
    const idx = providerMessageId.lastIndexOf(':');
    if (idx < 0) return null;
    const uid = Number(providerMessageId.slice(idx + 1));
    if (!Number.isInteger(uid) || uid <= 0) return null;
    return { mailbox: providerMessageId.slice(0, idx), uid };
  }

  private clientFor(creds: ImapCredentials): ImapFlow {
    return new ImapFlow({
      host: IMAP_HOST,
      port: 993,
      secure: true,
      auth: { user: creds.username, pass: creds.appPassword },
      logger: false,
    });
  }

  /** Maps transport errors to ImapAuthError; everything else passes through. */
  private asAuthError(err: unknown): Error {
    const e = err as {
      authenticationFailed?: boolean;
      responseText?: string;
      message?: string;
    };
    const text = `${e?.responseText ?? ''} ${e?.message ?? ''}`;
    if (
      e?.authenticationFailed ||
      /AUTHENTICATIONFAILED|invalid credentials|application-specific password required|authentication failed/i.test(
        text,
      )
    ) {
      return new ImapAuthError(
        'Google rejected the app password — check it or reconnect the account',
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
