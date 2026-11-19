import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, Repository } from 'typeorm';
import { TenantContextService } from '@/common/context/tenant-context.service';
import {
  EmailAccount,
  EmailProviderType,
  EmailSyncStatus,
} from './entities/email-account.entity';
import { EmailMessage } from './entities/email-message.entity';
import { EmailIngestService } from './email-ingest.service';
import {
  GmailApiError,
  GmailAuthError,
  GmailClientService,
} from './gmail/gmail-client.service';
import { ImapAuthError, ImapClientService } from './imap/imap-client.service';
import { labelsFor } from './imap/imap-mime';
import type { ImapFlow } from 'imapflow';

/** How far back the first sync reaches — keeps onboarding quick. */
const INITIAL_SYNC_MAX = 100;
/** Cap on history pages per pass so a busy mailbox cannot starve others. */
const MAX_HISTORY_PAGES = 5;
/** Trailing window re-checked each poll for flag changes and deletions. */
const FLAG_WINDOW = 200;

/** Cursor per watched IMAP mailbox: `{ "INBOX": "uidvalidity:lastUid" }`. */
type ImapCursor = Record<string, string>;

/**
 * Polls every connected mailbox for changes. Gmail offers push notifications
 * via Pub/Sub (`users.watch`), which needs a public endpoint plus a GCP topic
 * — polling `history.list` / IMAP every minute is the dependency-free version
 * and costs one request per account when nothing changed.
 */
@Injectable()
export class EmailSyncService {
  private readonly logger = new Logger(EmailSyncService.name);
  private running = false;

  constructor(
    @InjectRepository(EmailAccount)
    private readonly accounts: Repository<EmailAccount>,
    @InjectRepository(EmailMessage)
    private readonly messages: Repository<EmailMessage>,
    private readonly gmail: GmailClientService,
    private readonly imap: ImapClientService,
    private readonly ingest: EmailIngestService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async cron(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.tenantContext.runAsSystem(() =>
        this.accounts.find({
          where: {
            syncStatus: In([EmailSyncStatus.ACTIVE, EmailSyncStatus.ERROR]),
          },
        }),
      );
      for (const account of due) {
        try {
          await this.tenantContext.runWithTenant(account.tenantId, () =>
            this.syncAccount(account),
          );
        } catch (err) {
          this.logger.warn(
            `Sync failed for ${account.emailAddress}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Syncs one mailbox. The caller supplies the tenant context — the cron
   * supplies it per account, `syncNow` reuses the request's context.
   */
  async syncAccount(account: EmailAccount): Promise<void> {
    try {
      if (account.providerType === EmailProviderType.IMAP_SMTP) {
        await this.imapSync(account);
      } else if (!account.syncCursor) {
        await this.initialSync(account);
      } else {
        await this.incrementalSync(account);
      }
      await this.accounts.update(account.id, {
        syncStatus: EmailSyncStatus.ACTIVE,
        syncError: null,
        lastSyncedAt: new Date(),
      });
    } catch (err) {
      if (err instanceof GmailAuthError || err instanceof ImapAuthError) {
        await this.accounts.update(account.id, {
          syncStatus: EmailSyncStatus.ERROR,
          syncError: err.message,
        });
        return;
      }
      throw err;
    }
  }

  /* -------------------------------------------------------------- Gmail */

  /** First connect (or a lapsed history cursor): recent mail + a fresh cursor. */
  private async initialSync(account: EmailAccount): Promise<void> {
    const profile = await this.gmail.getProfile(account);
    let pageToken: string | undefined;
    let ingested = 0;
    do {
      const page = await this.gmail.listMessages(account, {
        maxResults: INITIAL_SYNC_MAX,
        pageToken,
      });
      for (const stub of page.messages ?? []) {
        await this.ingest.ingest(account, stub.id);
        ingested++;
      }
      pageToken = page.nextPageToken;
      // One page is enough for onboarding; the history cursor picks up the
      // rest as it changes instead of paying for a full backfill now.
    } while (pageToken && ingested < INITIAL_SYNC_MAX);

    await this.accounts.update(account.id, {
      syncCursor: profile.historyId ?? null,
    });
  }

  private async incrementalSync(account: EmailAccount): Promise<void> {
    let pageToken: string | undefined;
    let pages = 0;
    let newestHistoryId: string | undefined;

    do {
      let page;
      try {
        page = await this.gmail.listHistory(
          account,
          account.syncCursor!,
          pageToken,
        );
      } catch (err) {
        // HTTP 404 = the cursor is older than Gmail keeps — fall back to a
        // fresh list sync rather than failing forever.
        if (err instanceof GmailApiError && err.status === 404) {
          await this.accounts.update(account.id, { syncCursor: null });
          await this.initialSync(account);
          return;
        }
        throw err;
      }

      const added = new Set<string>();
      const deleted = new Set<string>();
      const relabelled = new Set<string>();
      for (const record of page.history ?? []) {
        record.messagesAdded?.forEach((m) => added.add(m.message.id));
        record.messagesDeleted?.forEach((m) => deleted.add(m.message.id));
        record.labelsAdded?.forEach((m) => relabelled.add(m.message.id));
        record.labelsRemoved?.forEach((m) => relabelled.add(m.message.id));
      }

      for (const id of added) {
        await this.ingest.ingest(account, id);
        deleted.delete(id);
        relabelled.delete(id);
      }
      for (const id of relabelled) {
        // Re-fetch the labels only — ingest is idempotent and cheaper than
        // diffing which flags moved.
        await this.ingest.ingest(account, id);
      }
      for (const id of deleted) {
        await this.ingest.removeMessage(account, id);
      }

      newestHistoryId = page.historyId ?? newestHistoryId;
      pageToken = page.nextPageToken;
      pages++;
    } while (pageToken && pages < MAX_HISTORY_PAGES);

    if (newestHistoryId) {
      await this.accounts.update(account.id, {
        syncCursor: newestHistoryId,
      });
    }
  }

  /* --------------------------------------------------------------- IMAP */

  /**
   * Polls INBOX + the Sent special-use mailbox. Each mailbox carries its own
   * `uidvalidity:lastUid` cursor; a UIDVALIDITY change or first run backfills
   * the newest INITIAL_SYNC_MAX, then incremental passes pick up new UIDs,
   * refresh flags in a trailing window and drop vanished messages.
   */
  private async imapSync(account: EmailAccount): Promise<void> {
    const client = await this.imap.connect(account);
    try {
      const boxes = await this.imap.listMailboxes(client);
      const watched = boxes.filter(
        (b) => b.specialUse === '\\Inbox' || b.specialUse === '\\Sent',
      );
      const cursor = JSON.parse(account.syncCursor ?? '{}') as ImapCursor;

      for (const box of watched) {
        await this.syncImapMailbox(client, account, box, cursor);
      }

      await this.accounts.update(account.id, {
        syncCursor: JSON.stringify(cursor),
      });
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  private async syncImapMailbox(
    client: ImapFlow,
    account: EmailAccount,
    box: { path: string; specialUse?: string; uidValidity: bigint },
    cursor: ImapCursor,
  ): Promise<void> {
    const uidValidity = box.uidValidity.toString();
    const entry = cursor[box.path];
    const [, lastUidStr] = entry?.startsWith(`${uidValidity}:`)
      ? entry.split(':')
      : [];
    const lastUid = lastUidStr ? Number(lastUidStr) : 0;

    const ctx = {
      mailboxPath: box.path,
      specialUse: box.specialUse,
      accountEmail: account.emailAddress,
    };

    const lock = await client.getMailboxLock(box.path);
    try {
      const toDate = (v: string | Date | undefined): Date | undefined =>
        v instanceof Date ? v : v ? new Date(v) : undefined;

      let newest = lastUid;
      if (lastUid === 0) {
        // Initial pass: newest N by sequence — no cursor to trust.
        const status = await client.status(box.path, { messages: true });
        const exists = status ? (status.messages ?? 0) : 0;
        const start = Math.max(1, exists - INITIAL_SYNC_MAX + 1);
        for await (const msg of client.fetch(`${start}:*`, {
          uid: true,
          flags: true,
          source: true,
          internalDate: true,
        })) {
          if (typeof msg === 'object' && msg.source) {
            await this.ingest.ingestImap(account, msg.source, {
              ...ctx,
              uid: msg.uid,
              flags: msg.flags,
              internalDate: toDate(msg.internalDate),
            });
            newest = Math.max(newest, msg.uid);
          }
        }
      } else {
        // New arrivals strictly after the cursor.
        const range = `${lastUid + 1}:*`;
        for await (const msg of client.fetch(range, {
          uid: true,
          flags: true,
          source: true,
          internalDate: true,
        })) {
          if (typeof msg === 'object' && msg.source) {
            await this.ingest.ingestImap(account, msg.source, {
              ...ctx,
              uid: msg.uid,
              flags: msg.flags,
              internalDate: toDate(msg.internalDate),
            });
            newest = Math.max(newest, msg.uid);
          }
        }

        await this.refreshImapWindow(account, client, box, lastUid);
      }
      cursor[box.path] = `${uidValidity}:${newest}`;
    } finally {
      lock.release();
    }
  }

  /**
   * Re-reads flags for the trailing window: updates labels on rows that
   * changed, and removes rows whose UID vanished from the mailbox.
   */
  private async refreshImapWindow(
    account: EmailAccount,
    client: ImapFlow,
    box: { path: string; specialUse?: string },
    lastUid: number,
  ): Promise<void> {
    const windowStart = Math.max(1, lastUid - FLAG_WINDOW + 1);
    const live = new Map<number, Set<string>>();
    for await (const msg of client.fetch(`${windowStart}:*`, {
      uid: true,
      flags: true,
    })) {
      if (typeof msg === 'object') live.set(msg.uid, msg.flags ?? new Set());
    }

    const stored = await this.messages.find({
      where: {
        tenantId: account.tenantId,
        emailAccountId: account.id,
        providerMessageId: Like(`${box.path}:%`),
      },
    });
    const threadsToRecompute = new Set<string>();
    for (const row of stored) {
      const parsed = this.imap.splitProviderId(row.providerMessageId);
      if (!parsed || parsed.uid < windowStart) continue;
      const flags = live.get(parsed.uid);
      if (!flags) {
        // Inside the window but gone from the server — expunged or moved.
        await this.ingest.removeMessage(account, row.providerMessageId);
        continue;
      }
      const labels = labelsFor(box.specialUse, box.path, flags);
      const threadId = await this.ingest.updateLabels(
        account,
        row.providerMessageId,
        labels,
      );
      if (threadId) threadsToRecompute.add(threadId);
    }
    for (const threadId of threadsToRecompute) {
      await this.ingest.recomputeThread(threadId, account);
    }
  }
}
