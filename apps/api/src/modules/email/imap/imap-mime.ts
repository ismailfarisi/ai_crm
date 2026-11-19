import { createHash } from 'node:crypto';
import PostalMime, {
  type Address as PostalAddress,
  type Email as ParsedEmail,
} from 'postal-mime';
import type { NormalizedMessage } from '../normalized-message';
import {
  EmailDirection,
  EmailMessageStatus,
} from '../entities/email-message.entity';

/**
 * Pseudo-labels derived from mailbox + flags so the shared thread recompute
 * (INBOX/TRASH/SPAM → folder, UNREAD → isRead, STARRED → isStarred) works
 * unchanged for IMAP mailboxes.
 */
export function labelsFor(
  specialUse: string | undefined,
  mailboxPath: string,
  flags: Set<string> | undefined,
): string[] {
  const labels: string[] = [];
  const isInbox =
    specialUse === '\\Inbox' || mailboxPath.toUpperCase() === 'INBOX';
  if (isInbox) labels.push('INBOX');
  if (specialUse === '\\Sent') labels.push('SENT');
  if (specialUse === '\\Trash') labels.push('TRASH');
  if (specialUse === '\\Junk') labels.push('SPAM');
  if (specialUse === '\\Drafts') labels.push('DRAFT');
  if (!flags?.has('\\Seen')) labels.push('UNREAD');
  if (flags?.has('\\Flagged')) labels.push('STARRED');
  return labels;
}

function flattenAddresses(
  addresses: PostalAddress[] | undefined,
): { name?: string; email: string }[] {
  const out: { name?: string; email: string }[] = [];
  for (const a of addresses ?? []) {
    if (a.group) {
      out.push(...flattenAddresses(a.group));
    } else if (a.address) {
      out.push({
        email: a.address.toLowerCase(),
        ...(a.name ? { name: a.name } : {}),
      });
    }
  }
  return out;
}

/** `Re: Fwd: Re: Hello` → `hello` — the subject-fallback thread key. */
export function normalizeSubject(subject: string | undefined): string {
  let s = (subject ?? '').trim();
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s.replace(/^\s*(re|fwd?|aw|sv|vs)\s*:\s*/i, '');
  }
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

/**
 * Threading without a provider thread id: the oldest References entry points
 * at the thread root (RFC 5322), so it makes the most stable key; In-Reply-To
 * is next; a lone message falls back to its normalized subject. Ingest first
 * looks the reference up in stored messageIdHeaders and adopts that thread
 * when it exists — the hash only keys genuinely new threads.
 */
export function imapThreadKey(parsed: ParsedEmail): string {
  const references = (parsed.references ?? '')
    .split(/\s+/)
    .map((r) => r.trim())
    .filter((r) => r.startsWith('<'));
  const root = references[0] ?? parsed.inReplyTo;
  if (root) return `ref:${sha1(root)}`;
  return subjectThreadKey(parsed.subject);
}

/**
 * Subject-only key for messages we compose ourselves — matches the key a
 * lone incoming message with the same subject would compute.
 */
export function subjectThreadKey(subject: string | undefined): string {
  return `subj:${sha1(normalizeSubject(subject))}`;
}

/** The message-id headers worth matching on, oldest root first. */
export function threadAnchors(parsed: ParsedEmail): string[] {
  const anchors: string[] = [];
  for (const ref of (parsed.references ?? '').split(/\s+/)) {
    const trimmed = ref.trim();
    if (trimmed.startsWith('<') && !anchors.includes(trimmed)) {
      anchors.push(trimmed);
    }
  }
  if (parsed.inReplyTo && !anchors.includes(parsed.inReplyTo)) {
    anchors.push(parsed.inReplyTo);
  }
  return anchors;
}

export interface ImapMessageContext {
  mailboxPath: string;
  specialUse: string | undefined;
  uid: number;
  flags?: Set<string>;
  /** INTERNALDATE fallback when the Date header is missing/bogus. */
  internalDate?: Date;
  accountEmail: string;
}

/**
 * Raw RFC822 → the normalized row shape. providerMessageId embeds the mailbox
 * because UIDs are only unique per mailbox; attachment locators are
 * `mailbox:uid:index` so a download can re-fetch and re-parse.
 */
export function imapToNormalized(
  parsed: ParsedEmail,
  ctx: ImapMessageContext,
): NormalizedMessage {
  const labelIds = labelsFor(ctx.specialUse, ctx.mailboxPath, ctx.flags);
  const from = flattenAddresses(parsed.from ? [parsed.from] : [])[0];
  const direction =
    labelIds.includes('SENT') || from?.email === ctx.accountEmail.toLowerCase()
      ? EmailDirection.OUTBOUND
      : EmailDirection.INBOUND;
  const isDraft = labelIds.includes('DRAFT');
  const sentAt = parsed.date ? new Date(parsed.date) : new Date(NaN);
  const providerMessageId = `${ctx.mailboxPath}:${ctx.uid}`;

  return {
    providerMessageId,
    providerThreadId: imapThreadKey(parsed),
    labelIds,
    messageIdHeader: parsed.messageId ?? null,
    inReplyToHeader: parsed.inReplyTo ?? null,
    direction,
    status: isDraft
      ? EmailMessageStatus.DRAFT
      : direction === EmailDirection.OUTBOUND
        ? EmailMessageStatus.SENT
        : EmailMessageStatus.RECEIVED,
    fromEmail: from?.email ?? 'unknown',
    fromName: from?.name ?? null,
    toEmails: flattenAddresses(parsed.to),
    ccEmails: flattenAddresses(parsed.cc),
    bccEmails: flattenAddresses(parsed.bcc),
    subject: parsed.subject ?? '',
    bodyText: parsed.text ?? '',
    bodyHtml: parsed.html ?? '',
    attachments: parsed.attachments.map((a, i) => ({
      providerAttachmentId: `${providerMessageId}:${i}`,
      filename: a.filename ?? 'attachment',
      mimeType: a.mimeType || 'application/octet-stream',
      sizeBytes:
        typeof a.content === 'string'
          ? Buffer.byteLength(a.content)
          : (a.content?.byteLength ?? 0),
    })),
    sentAt: Number.isNaN(sentAt.getTime())
      ? (ctx.internalDate ?? new Date())
      : sentAt,
    snippet: (parsed.text ?? '').replace(/\s+/g, ' ').slice(0, 200),
  };
}

export async function parseRaw(raw: Buffer | string): Promise<ParsedEmail> {
  return PostalMime.parse(raw);
}
