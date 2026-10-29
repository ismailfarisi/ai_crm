/**
 * Where an expense claim's receipt lives.
 *
 * `receiptUrl` holds either a link (claims from before receipts were stored)
 * or a reference to an attachment on the claim, `attachment:<id>`. A
 * reference, not a URL: stored files are only ever served through short-lived
 * signed links, so the screen asks for one each time it shows the receipt.
 */
export const RECEIPT_ATTACHMENT_PREFIX = 'attachment:';

export const receiptAttachmentRef = (attachmentId: string): string =>
  `${RECEIPT_ATTACHMENT_PREFIX}${attachmentId}`;

/** The attachment id a `receiptUrl` points at, or null when it is a plain link. */
export function receiptAttachmentId(receiptUrl: string | null | undefined): string | null {
  if (!receiptUrl?.startsWith(RECEIPT_ATTACHMENT_PREFIX)) return null;
  const id = receiptUrl.slice(RECEIPT_ATTACHMENT_PREFIX.length);
  return id || null;
}

/** What a receipt may be stored as: something a person can look at and a scan can read. */
export const RECEIPT_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
] as const;

export const isReceiptContentType = (v: string): boolean =>
  (RECEIPT_CONTENT_TYPES as readonly string[]).includes(v);
