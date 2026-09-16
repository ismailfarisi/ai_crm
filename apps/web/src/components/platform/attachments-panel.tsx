'use client';

import { useRef } from 'react';
import { Download, Paperclip, Trash2, Upload } from 'lucide-react';
import {
  ATTACHMENT_MAX_BYTES,
  formatBytes,
  type AttachmentOwnerType,
} from '@saas/shared';
import {
  useAttachments,
  useOpenAttachment,
  useRemoveAttachment,
  useUploadAttachment,
} from '@/hooks/use-platform';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';

interface AttachmentsPanelProps {
  ownerType: AttachmentOwnerType;
  ownerId: string;
  /** False when the viewer can read the record but not change it. */
  canEdit?: boolean;
}

/**
 * Files on a record: artwork, a signed order, a scan of the bill.
 *
 * There is no permission of its own — the panel is shown wherever the record
 * is, and the API decides what the viewer may do with it. `canEdit` only hides
 * controls that would fail anyway.
 */
export function AttachmentsPanel({ ownerType, ownerId, canEdit = true }: AttachmentsPanelProps) {
  const picker = useRef<HTMLInputElement>(null);
  const { data: files = [], isLoading } = useAttachments(ownerType, ownerId);
  const upload = useUploadAttachment(ownerType, ownerId);
  const remove = useRemoveAttachment(ownerType, ownerId);
  const open = useOpenAttachment();

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Paperclip className="h-4 w-4" /> Files
          {files.length > 0 && <span className="text-sm text-ink-muted">({files.length})</span>}
        </CardTitle>
        {canEdit && (
          <>
            <input
              ref={picker}
              type="file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload.mutate(file);
                event.target.value = '';
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => picker.current?.click()}
              disabled={upload.isPending}
            >
              <Upload className="mr-1.5 h-4 w-4" />
              {upload.isPending ? 'Uploading…' : 'Attach'}
            </Button>
          </>
        )}
      </CardHeader>
      <CardBody>
        {isLoading ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Nothing attached yet. PDFs, images and office documents up to{' '}
            {formatBytes(ATTACHMENT_MAX_BYTES)}.
          </p>
        ) : (
          <ul className="divide-y divide-border/25">
            {files.map((file) => (
              <li key={file.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <button
                    type="button"
                    className="truncate text-sm font-medium text-ink hover:underline"
                    onClick={() => open.mutate(file.id)}
                  >
                    {file.filename}
                  </button>
                  <p className="text-xs text-ink-muted">
                    {formatBytes(file.sizeBytes)}
                    {file.uploadedByName ? ` · ${file.uploadedByName}` : ''} ·{' '}
                    {new Date(file.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Download ${file.filename}`}
                    className="rounded p-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink"
                    onClick={() => open.mutate(file.id)}
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      aria-label={`Remove ${file.filename}`}
                      className="rounded p-1.5 text-ink-muted hover:bg-danger-soft/60 hover:text-danger"
                      onClick={() => remove.mutate(file.id)}
                      disabled={remove.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
