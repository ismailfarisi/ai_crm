/* Email client DTOs shared between the API and the web app. */

export const EMAIL_PROVIDER_TYPES = [
  'GMAIL_OAUTH',
  'IMAP_SMTP',
] as const;
export type EmailProviderType = (typeof EMAIL_PROVIDER_TYPES)[number];

export const EMAIL_SYNC_STATUSES = ['ACTIVE', 'ERROR', 'PAUSED'] as const;
export type EmailSyncStatus = (typeof EMAIL_SYNC_STATUSES)[number];

export const EMAIL_FOLDERS = [
  'INBOX',
  'SENT',
  'DRAFTS',
  'ARCHIVE',
  'SPAM',
  'TRASH',
] as const;
export type EmailFolder = (typeof EMAIL_FOLDERS)[number];

export const EMAIL_DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;
export type EmailDirection = (typeof EMAIL_DIRECTIONS)[number];

export interface EmailAccountDto {
  id: string;
  emailAddress: string;
  name: string;
  providerType: EmailProviderType;
  /** Mailbox every `email:read` holder in the org can see; otherwise owner-only. */
  isShared: boolean;
  /** True when the caller owns this account. */
  isMine: boolean;
  syncStatus: EmailSyncStatus;
  syncError: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
}

export interface EmailThreadDto {
  id: string;
  emailAccountId: string;
  accountEmail: string;
  contactId: string | null;
  subject: string;
  snippet: string;
  folder: EmailFolder;
  isRead: boolean;
  isStarred: boolean;
  participants: string[];
  lastMessageAt: string;
  messageCount: number;
}

export interface EmailAttachmentDto {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface EmailMessageDto {
  id: string;
  threadId: string;
  direction: EmailDirection;
  fromEmail: string;
  fromName: string | null;
  toEmails: { name?: string; email: string }[];
  ccEmails: { name?: string; email: string }[];
  bccEmails: { name?: string; email: string }[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  hasAttachments: boolean;
  attachments: EmailAttachmentDto[];
  sentAt: string;
}

export interface EmailThreadDetailDto extends EmailThreadDto {
  messages: EmailMessageDto[];
}

/** Returned by GET /email/oauth/google/start — the browser navigates to `url`. */
export interface GoogleOAuthStartDto {
  url: string;
}
