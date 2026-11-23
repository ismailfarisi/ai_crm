import { safeFilename } from '@saas/shared';
import type { InboundMedia } from './interfaces/channel-driver.interface';

/**
 * A file that came with a message, as `metadata.files` holds it. It starts as
 * the provider's reference; once the bytes are copied into our store it gains
 * `attachmentId`, or `error` when they could not be had.
 */
export interface StoredMessageFile {
  /** The provider's id for the file. */
  ref: string;
  mimeType: string;
  filename: string;
  attachmentId?: string;
  sizeBytes?: number;
  error?: string;
}

/** What the inbox is told about a message's file. */
export interface MessageFileDto {
  filename: string;
  mimeType: string;
  /** `saving` while the copy runs, `failed` when it did not arrive. */
  status: 'saved' | 'saving' | 'failed';
  /** Set once saved: the id the attachment link endpoint takes. */
  attachmentId?: string;
  sizeBytes?: number;
}

/** A copy still missing after this long was interrupted, not slow. */
const SAVING_WINDOW_MS = 10 * 60 * 1000;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'video/mp4': 'mp4',
};

/** A photo arrives without a name; it is given one that says what it is. */
export function filenameFor(file: InboundMedia, index: number): string {
  if (file.filename?.trim()) return safeFilename(file.filename);
  const kind = file.mimeType.split('/')[0];
  const label =
    kind === 'image'
      ? 'photo'
      : kind === 'audio'
        ? 'audio'
        : kind === 'video'
          ? 'video'
          : 'file';
  const ext = EXTENSIONS[file.mimeType];
  return `${label}-${index + 1}${ext ? `.${ext}` : ''}`;
}

export function toMessageFileDtos(
  message: { metadata?: Record<string, any> | null; createdAt?: Date },
  now: number = Date.now(),
): MessageFileDto[] {
  const files = message.metadata?.files;
  if (!Array.isArray(files)) return [];
  const age = message.createdAt
    ? now - new Date(message.createdAt).getTime()
    : Infinity;
  return (files as StoredMessageFile[]).map((file) => ({
    filename: file.filename,
    mimeType: file.mimeType,
    status: file.attachmentId
      ? 'saved'
      : file.error || age > SAVING_WINDOW_MS
        ? 'failed'
        : 'saving',
    ...(file.attachmentId ? { attachmentId: file.attachmentId } : {}),
    ...(file.sizeBytes != null ? { sizeBytes: file.sizeBytes } : {}),
  }));
}
