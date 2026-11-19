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

  /** Store a message we already have the payload for (e.g. right after send). */
  async store(account: EmailAccount, message: GmailMessage): Promise<void> {
    const headers = message.payload?.headers;
    const labelIds = message.labelIds ?? [];

    const thread =
      (await this.threads.findOne({
        where: {
          tenantId: account.tenantId,
          emailAccountId: account.id,
          gmailThreadId: message.threadId,
        },
      })) ??
      (await this.threads.save(
        this.threads.create({
          tenantId: account.tenantId,
          emailAccountId: account.id,
          gmailThreadId: message.threadId,
          subject: '',
          snippet: '',
          participants: [],
          lastMessageAt: new Date(Number(message.internalDate ?? Date.now())),
          messageCount: 0,
        }),
      ));

    const existing = await this.messages.findOne({
      where: {
        tenantId: account.tenantId,
        emailAccountId: account.id,
        gmailMessageId: message.id,
      },
    });

    const parsed = extractBody(message.payload ?? {});
    const fromHeader = headerValue(headers, 'From');
    const isDraft = labelIds.includes('DRAFT');
    const direction =
      labelIds.includes('SENT') ||
      firstEmailFromAddress(fromHeader) === account.emailAddress.toLowerCase()
        ? EmailDirection.OUTBOUND
        : EmailDirection.INBOUND;
    const status = isDraft
      ? EmailMessageStatus.DRAFT
      : direction === EmailDirection.OUTBOUND
        ? EmailMessageStatus.SENT
        : EmailMessageStatus.RECEIVED;

    const row = existing ?? this.messages.create();
    Object.assign(row, {
      tenantId: account.tenantId,
      threadId: thread.id,
      emailAccountId: account.id,
      gmailMessageId: message.id,
      messageIdHeader: headerValue(headers, 'Message-ID') || null,
      inReplyToHeader: headerValue(headers, 'In-Reply-To') || null,
      direction,
      fromEmail: firstEmailFromAddress(fromHeader) || 'unknown',
      fromName: displayNameFromAddress(fromHeader),
      toEmails: parseAddressHeader(headerValue(headers, 'To')),
      ccEmails: parseAddressHeader(headerValue(headers, 'Cc')),
      bccEmails: parseAddressHeader(headerValue(headers, 'Bcc')),
      subject: headerValue(headers, 'Subject'),
      bodyText: parsed.text,
      bodyHtml: parsed.html,
      labelIds,
      hasAttachments: parsed.attachments.length > 0,
      status,
      sentAt: new Date(Number(message.internalDate ?? Date.now())),
    });
    const saved = await this.messages.save(row);

    if (parsed.attachments.length > 0) {
      await this.attachments.delete({ emailMessageId: saved.id });
      await this.attachments.save(
        parsed.attachments.map((a) =>
          this.attachments.create({
            tenantId: account.tenantId,
            emailMessageId: saved.id,
            gmailAttachmentId: a.gmailAttachmentId,
            filename: a.filename,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
          }),
        ),
      );
    }

    await this.recomputeThread(thread.id, account, message.snippet);
  }

  /**
   * Deletes a message the provider says is gone and re-rolls the thread;
   * a thread with nothing left in it goes too.
   */
  async removeMessage(
    account: EmailAccount,
    gmailMessageId: string,
  ): Promise<void> {
    const message = await this.messages.findOne({
      where: {
        tenantId: account.tenantId,
        emailAccountId: account.id,
        gmailMessageId,
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
