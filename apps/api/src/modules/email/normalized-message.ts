import type {
  EmailDirection,
  EmailMessageStatus,
} from './entities/email-message.entity';

/**
 * A provider message flattened into the shape EmailIngestService stores.
 * Gmail's part tree and an IMAP RFC822 blob both reduce to this — everything
 * downstream (threading, dedupe, labels) is provider-agnostic.
 */
export interface NormalizedMessage {
  /** Provider message id — Gmail id, or `mailboxPath:uid` for IMAP. */
  providerMessageId: string;
  providerThreadId: string;
  /** Pseudo-labels driving folder/read/starred recomputes. */
  labelIds: string[];
  messageIdHeader: string | null;
  inReplyToHeader: string | null;
  direction: EmailDirection;
  status: EmailMessageStatus;
  fromEmail: string;
  fromName: string | null;
  toEmails: { name?: string; email: string }[];
  ccEmails: { name?: string; email: string }[];
  bccEmails: { name?: string; email: string }[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  attachments: {
    providerAttachmentId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }[];
  sentAt: Date;
  snippet?: string;
}
