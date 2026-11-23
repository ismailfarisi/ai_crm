'use client';

import { useEffect, useState } from 'react';
import { Download, FileText, Loader2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { formatBytes } from '@saas/shared';
import { api, type ChannelMessageFileDto } from '@/lib/api/endpoints';

/** A body that only names the file adds nothing once the file itself is shown. */
const PLACEHOLDER = /^\[[^\]]*\]$/;

export function isFilePlaceholder(body: string, files?: ChannelMessageFileDto[]): boolean {
  return !!files?.length && PLACEHOLDER.test(body.trim());
}

/** The files that came with a message: pictures as previews, the rest as rows. */
export function MessageFiles({ files }: { files: ChannelMessageFileDto[] }) {
  return (
    <ul className="mb-1.5 flex flex-col gap-1.5" aria-label="Files">
      {files.map((file, index) => (
        <li key={file.attachmentId ?? `${file.filename}-${index}`}>
          <MessageFile file={file} />
        </li>
      ))}
    </ul>
  );
}

function MessageFile({ file }: { file: ChannelMessageFileDto }) {
  const isPicture = file.status === 'saved' && file.mimeType.startsWith('image/');
  const [preview, setPreview] = useState<string | null>(null);

  // A signed link lasts minutes, so a preview's is fetched when it is shown.
  useEffect(() => {
    if (!isPicture || !file.attachmentId) return;
    let live = true;
    api.attachments
      .link(file.attachmentId)
      .then((link) => live && setPreview(link.url))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [isPicture, file.attachmentId]);

  const download = async () => {
    if (!file.attachmentId) return;
    try {
      // A fresh link each time: the one behind the preview may have expired.
      const link = await api.attachments.link(file.attachmentId);
      window.open(link.url, '_blank', 'noopener');
    } catch {
      toast.error(`Could not open ${file.filename}`);
    }
  };

  if (file.status !== 'saved') {
    const failed = file.status === 'failed';
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted/40 px-2.5 py-1.5 text-xs text-ink-muted">
        {failed ? (
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
        ) : (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        )}
        <span className="min-w-0 truncate font-medium text-ink">{file.filename}</span>
        <span className="shrink-0">{failed ? 'Could not be saved' : 'Saving…'}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={download}
      aria-label={`Download ${file.filename}`}
      className="group flex w-full max-w-xs flex-col overflow-hidden rounded-lg border border-border bg-surface-muted/40 text-left transition hover:border-border-strong"
    >
      {isPicture && preview && (
        // A signed, short-lived API URL: next/image cannot optimise it.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt={file.filename} className="max-h-56 w-full object-cover" />
      )}
      <span className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
        <FileText className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium text-ink">{file.filename}</span>
        {file.sizeBytes != null && (
          <span className="shrink-0 tabular-nums text-ink-muted">{formatBytes(file.sizeBytes)}</span>
        )}
        <Download className="h-3.5 w-3.5 shrink-0 text-ink-muted group-hover:text-ink" aria-hidden />
      </span>
    </button>
  );
}
