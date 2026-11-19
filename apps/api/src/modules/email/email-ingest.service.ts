import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from '@/modules/contacts/entities/contact.entity';
import { EmailAccount } from './entities/email-account.entity';
import { EmailAttachment } from './entities/email-attachment.entity';
import {
  EmailMessage,
  EmailDirection,
  EmailMessageStatus,
} from './entities/email-message.entity';
import { EmailFolder, EmailThread } from './entities/email-thread.entity';
import {
  GmailClientService,
  type GmailMessage,
} from './gmail/gmail-client.service';
import {
  imapThreadKey,
  parseRaw,
  imapToNormalized,
  threadAnchors,
  type ImapMessageContext,
} from './imap/imap-mime';
import type { NormalizedMessage } from './normalized-message';
import type { Email } from 'postal-mime';
import {
  displayNameFromAddress,
  extractBody,
  firstEmailFromAddress,
  headerValue,
  parseAddressHeader,
} from './gmail/mime';

/** Folder precedence when a thread's messages disagree — inbox wins. */
const FOLDER_PRIORITY: [string, EmailFolder][] = [
  ['INBOX', EmailFolder.INBOX],
  ['TRASH', EmailFolder.TRASH],
  ['SPAM', EmailFolder.SPAM],
  ['SENT', EmailFolder.SENT],
  ['DRAFT', EmailFolder.DRAFTS],
];

/**
 * Turns one provider message into our thread/message/attachment rows. Every
 * write is keyed on the provider's own ids, so re-ingesting the same message
 * is a no-op and a message that moves threads gets re-filed.
 */
@Injectable()
export class EmailIngestService {
  private readonly logger = new Logger(EmailIngestService.name);

  constructor(
    @InjectRepository(EmailAccount)
    private readonly accounts: Repository<EmailAccount>,
    @InjectRepository(EmailThread)
    private readonly threads: Repository<EmailThread>,
    @InjectRepository(EmailMessage)
    private readonly messages: Repository<EmailMessage>,
    @InjectRepository(EmailAttachment)
    private readonly attachments: Repository<EmailAttachment>,
    @InjectRepository(Contact)
    private readonly contacts: Repository<Contact>,
    private readonly gmail: GmailClientService,
  ) {}

  /* ------------------------------------------------------------ providers */

  /** Fetch + store one Gmail message. Safe to call on already-known ids. */
  async ingest(account: EmailAccount, gmailMessageId: string): Promise<void> {
    let message: GmailMessage;
    try {
      message = await this.gmail.getMessage(account, gmailMessageId);
    } catch (err) {
      this.logger.warn(
        `Could not fetch message ${gmailMessageId} for ${account.emailAddress}: ${String(err)}`,
      );
      return;
    }
    await this.store(account, message);
  }

  /** Parse + store one IMAP message handed over as raw RFC822. */
  async ingestImap(
    account: EmailAccount,
    raw: Buffer,
    ctx: ImapMessageContext,
  ): Promise<void> {
    let parsed: Email;
    try {
      parsed = await parseRaw(raw);
    } catch (err) {
      this.logger.warn(
        `Could not parse ${ctx.mailboxPath}:${ctx.uid} for ${account.emailAddress}: ${String(err)}`,
      );
      return;
    }
    const normalized = imapToNormalized(parsed, ctx);
    normalized.providerThreadId = await this.resolveImapThreadKey(
      account,
      parsed,
      normalized.providerThreadId,
    );
    await this.storeNormalized(account, normalized);
  }

  /**
   * Chains a new message onto an existing thread when any of its reference
   * anchors already lives in the mailbox — a subject-hash key only ever
   * stands up genuinely new threads.
   */
  private async resolveImapThreadKey(
    account: EmailAccount,
    parsed: Email,
    fallback: string,
  ): Promise<string> {
    for (const anchor of threadAnchors(parsed)) {
      const parent = await this.messages.findOne({
        where: {
          tenantId: account.tenantId,
          emailAccountId: account.id,
          messageIdHeader: anchor,
        },
      });
      if (!parent) continue;
      const thread = await this.threads.findOne({
        where: { id: parent.threadId },
      });
      if (thread) return thread.providerThreadId;
    }
    return fallback || imapThreadKey(parsed);
  }

  /* --------------------------------------------------------------- store */

  /** Store a message we already have the Gmail payload for (post-send). */
  async store(account: EmailAccount, message: GmailMessage): Promise<void> {
    await this.storeNormalized(
      account,
      this.gmailToNormalized(account, message),
    );
  }

  private gmailToNormalized(
    account: EmailAccount,
    message: GmailMessage,
  ): NormalizedMessage {
    const headers = message.payload?.headers;
    const labelIds = message.labelIds ?? [];
    const parsed = extractBody(message.payload ?? {});
    const fromHeader = headerValue(headers, 'From');
    const isDraft = labelIds.includes('DRAFT');
    const direction =
      labelIds.includes('SENT') ||
      firstEmailFromAddress(fromHeader) === account.emailAddress.toLowerCase()
        ? EmailDirection.OUTBOUND
        : EmailDirection.INBOUND;

    return {
      providerMessageId: message.id,
      providerThreadId: message.threadId,
      labelIds,
      messageIdHeader: headerValue(headers, 'Message-ID') || null,
      inReplyToHeader: headerValue(headers, 'In-Reply-To') || null,
      direction,
      status: isDraft
        ? EmailMessageStatus.DRAFT
        : direction === EmailDirection.OUTBOUND
          ? EmailMessageStatus.SENT
          : EmailMessageStatus.RECEIVED,
      fromEmail: firstEmailFromAddress(fromHeader) || 'unknown',
      fromName: displayNameFromAddress(fromHeader),
      toEmails: parseAddressHeader(headerValue(headers, 'To')),
      ccEmails: parseAddressHeader(headerValue(headers, 'Cc')),
      bccEmails: parseAddressHeader(headerValue(headers, 'Bcc')),
      subject: headerValue(headers, 'Subject'),
      bodyText: parsed.text,
      bodyHtml: parsed.html,
      attachments: parsed.attachments.map((a) => ({
        providerAttachmentId: a.gmailAttachmentId,
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
      })),
      sentAt: new Date(Number(message.internalDate ?? Date.now())),
      snippet: message.snippet,
    };
  }

  /**
   * The provider-agnostic write path. Rows are keyed on the provider id;
   * a message first stored optimistically (SMTP send) is re-keyed to its
   * real IMAP id when the server copy arrives, matched by Message-ID.
   */
  async storeNormalized(
    account: EmailAccount,
    n: NormalizedMessage,
  ): Promise<EmailMessage> {
    const thread =
      (await this.threads.findOne({
        where: {
          tenantId: account.tenantId,
          emailAccountId: account.id,
          providerThreadId: n.providerThreadId,
        },
      })) ??
      (await this.threads.save(
        this.threads.create({
          tenantId: account.tenantId,
          emailAccountId: account.id,
          providerThreadId: n.providerThreadId,
          subject: '',
          snippet: '',
          participants: [],
          lastMessageAt: n.sentAt,
          messageCount: 0,
        }),
      ));

    let existing = await this.messages.findOne({
      where: {
        tenantId: account.tenantId,
        emailAccountId: account.id,
        providerMessageId: n.providerMessageId,
      },
    });
    if (!existing && n.messageIdHeader) {
      // Optimistically stored SMTP sends carry a `sent:` id; the real IMAP
      // copy adopts this row instead of duplicating.
      existing = await this.messages.findOne({
        where: {
          tenantId: account.tenantId,
          emailAccountId: account.id,
          messageIdHeader: n.messageIdHeader,
        },
      });
    }

    const row = existing ?? this.messages.create();
    Object.assign(row, {
      tenantId: account.tenantId,
      threadId: thread.id,
      emailAccountId: account.id,
      providerMessageId: n.providerMessageId,
      messageIdHeader: n.messageIdHeader,
      inReplyToHeader: n.inReplyToHeader,
      direction: n.direction,
      fromEmail: n.fromEmail,
      fromName: n.fromName,
      toEmails: n.toEmails,
      ccEmails: n.ccEmails,
      bccEmails: n.bccEmails,
      subject: n.subject,
      bodyText: n.bodyText,
      bodyHtml: n.bodyHtml,
      labelIds: n.labelIds,
      hasAttachments: n.attachments.length > 0,
      status: n.status,
      sentAt: n.sentAt,
    });
    const saved = await this.messages.save(row);

    if (n.attachments.length > 0 || row.hasAttachments) {
      await this.attachments.delete({ emailMessageId: saved.id });
      if (n.attachments.length > 0) {
        await this.attachments.save(
          n.attachments.map((a) =>
            this.attachments.create({
              tenantId: account.tenantId,
              emailMessageId: saved.id,
              providerAttachmentId: a.providerAttachmentId,
              filename: a.filename,
              mimeType: a.mimeType,
              sizeBytes: a.sizeBytes,
            }),
          ),
        );
      }
    }

    await this.recomputeThread(thread.id, account, n.snippet);
    return saved;
  }

  /**
   * Flag-only refresh for a stored message (IMAP poll saw different flags).
   * Returns the threadId if the row existed so the caller can recompute.
   */
  async updateLabels(
    account: EmailAccount,
    providerMessageId: string,
    labelIds: string[],
  ): Promise<string | null> {
    const message = await this.messages.findOne({
      where: {
        tenantId: account.tenantId,
        emailAccountId: account.id,
        providerMessageId,
      },
    });
    if (!message) return null;
    const changed =
      labelIds.length !== message.labelIds.length ||
      labelIds.some((l) => !message.labelIds.includes(l));
    if (!changed) return message.threadId;
    message.labelIds = labelIds;
    await this.messages.save(message);
    return message.threadId;
  }

  /**
   * Deletes a message the provider says is gone and re-rolls the thread;
   * a thread with nothing left in it goes too.
   */
  async removeMessage(
    account: EmailAccount,
    providerMessageId: string,
  ): Promise<void> {
    const message = await this.messages.findOne({
      where: {
        tenantId: account.tenantId,
        emailAccountId: account.id,
        providerMessageId,
      },
    });
    if (!message) return;
    const threadId = message.threadId;
    await this.messages.remove(message);
    const remaining = await this.messages.count({ where: { threadId } });
    if (remaining === 0) {
      await this.threads.delete({ id: threadId });
    } else {
      await this.recomputeThread(threadId, account);
    }
  }

  /** Re-derives every aggregate on the thread from its stored messages. */
  async recomputeThread(
    threadId: string,
    account: EmailAccount,
    snippet?: string,
  ): Promise<void> {
    const thread = await this.threads.findOneByOrFail({ id: threadId });
    const messages = await this.messages.find({
      where: { threadId },
      order: { sentAt: 'ASC' },
    });
    if (messages.length === 0) return;

    const latest = messages[messages.length - 1];
    const labelUnion = new Set(messages.flatMap((m) => m.labelIds));
    const folder =
      FOLDER_PRIORITY.find(([label]) => labelUnion.has(label))?.[1] ??
      EmailFolder.ARCHIVE;
    const participants = [
      ...new Set(
        messages.flatMap((m) => [
          m.fromEmail,
          ...m.toEmails.map((e) => e.email),
          ...m.ccEmails.map((e) => e.email),
        ]),
      ),
    ].filter(Boolean);

    let contactId = thread.contactId;
    if (!contactId) {
      contactId = await this.matchContact(account, participants);
    }

    await this.threads.update(threadId, {
      subject: latest.subject || thread.subject,
      snippet: snippet ?? (latest.bodyText.slice(0, 200) || thread.snippet),
      folder,
      isRead: !labelUnion.has('UNREAD'),
      isStarred: labelUnion.has('STARRED'),
      participants,
      lastMessageAt: latest.sentAt,
      messageCount: messages.length,
      contactId,
    });
  }

  private async matchContact(
    account: EmailAccount,
    participantEmails: string[],
  ): Promise<string | null> {
    const own = account.emailAddress.toLowerCase();
    for (const email of participantEmails) {
      if (email.toLowerCase() === own) continue;
      const contact = await this.contacts.findOne({
        where: { tenantId: account.tenantId, email: email.toLowerCase() },
      });
      if (contact) return contact.id;
    }
    return null;
  }
}
