/**
 * Files hung off a document: artwork, a signed purchase order, a bill scan.
 *
 * An attachment has no permissions of its own. It inherits them from the
 * record it belongs to — if you can read the quote you can read its artwork,
 * and if you can edit the quote you can add and remove files on it. A
 * separate `attachment:read` would be a second, quieter answer to a question
 * the owner record has already answered.
 */
export const ATTACHMENT_OWNER_TYPES = [
  'QUOTE',
  'INVOICE',
  'PURCHASE_ORDER',
  'BILL',
  'EXPENSE_CLAIM',
] as const;
export type AttachmentOwnerType = (typeof ATTACHMENT_OWNER_TYPES)[number];

export interface AttachmentDto {
  id: string;
  ownerType: AttachmentOwnerType;
  ownerId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedById: string | null;
  uploadedByName: string | null;
  createdAt: string;
}

export interface AttachmentLinkDto {
  url: string;
  expiresAt: string;
  filename: string;
}

/** 25 MB. Artwork PDFs are the large case; anything bigger belongs in a DAM. */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * What may be stored. An allowlist, not a denylist: the store is served back
 * to browsers, so `text/html` and friends would be a stored-XSS vector on the
 * API's own origin.
 */
export const ATTACHMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/postscript',
] as const;

export function isAllowedAttachmentType(contentType: string): boolean {
  return (ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(
    contentType.split(';')[0].trim().toLowerCase(),
  );
}

/**
 * Strips everything a filename could smuggle: path separators, traversal,
 * control characters and leading dots. What is left is still shown to the
 * user, so it keeps spaces and unicode.
 */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);
  return cleaned || 'file';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 104857.6) / 10} MB`;
}

/**
 * What a company logo may be.
 *
 * Narrower than `ATTACHMENT_CONTENT_TYPES` on purpose. A logo is the one
 * stored file served back *inline* — it has to render in a document and on the
 * public quote page a customer opens without signing in — and an inline
 * `image/svg+xml` is a script that runs on the origin serving it. Raster only,
 * so there is nothing to execute.
 */
export const LOGO_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** 2 MB. A letterhead logo that is larger than this is the wrong asset. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
