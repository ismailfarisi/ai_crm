'use client';

import { useRef } from 'react';
import { FileImage, MessageSquare, Upload, XCircle } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  isAllowedProofType,
  latestProof,
  QUOTE_PROOF_STATUS_LABELS,
  type QuoteProofStatus,
  type QuoteProofsSummaryDto,
} from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { useOpenAttachment } from '@/hooks/use-platform';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { SendOnWhatsAppButton } from '@/components/whatsapp/send-on-whatsapp';

const TONE: Record<QuoteProofStatus, 'warning' | 'success' | 'danger'> = {
  PENDING: 'warning',
  APPROVED: 'success',
  CHANGES_REQUESTED: 'danger',
};

const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';

export const quoteProofsKey = (quoteId: string) => ['quotes', quoteId, 'proofs'] as const;

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : '';
}

/**
 * Artwork proofs the customer signs off on the quote link, and what they last
 * said about the quote itself. Each upload is the next version and replaces
 * the one before it.
 */
export function QuoteProofsPanel({
  quoteId,
  canEdit,
  accepted,
  customerName = null,
}: {
  quoteId: string;
  canEdit: boolean;
  accepted: boolean;
  customerName?: string | null;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const open = useOpenAttachment();
  const { data } = useQuery({
    queryKey: quoteProofsKey(quoteId),
    queryFn: () => api.quoteAcceptance.proofs(quoteId),
  });
  const store = (next: QuoteProofsSummaryDto) => {
    queryClient.setQueryData(quoteProofsKey(quoteId), next);
    void queryClient.invalidateQueries({ queryKey: ['audit'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.attachments('QUOTE', quoteId) });
  };
  const upload = useMutation({
    mutationFn: (file: File) => api.quoteAcceptance.uploadProof(quoteId, file),
    onSuccess: (next) => {
      store(next);
      toast.success(`Proof v${latestProof(next.proofs)?.version ?? 1} added. The customer sees it on their quote link.`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not upload the proof'),
  });
  const rule = useMutation({
    mutationFn: (required: boolean) => api.quoteAcceptance.setProofRequired(quoteId, required),
    onSuccess: ({ proofRequired }) =>
      data && store({ ...data, proofRequired, proofRequiredFromDefault: false }),
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not change the setting'),
  });

  if (!data) return null;
  const latest = latestProof(data.proofs);
  const response = data.customerResponse;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <FileImage className="h-4 w-4" /> Artwork proof
        </CardTitle>
        {canEdit && (
          <>
            <input
              ref={picker}
              type="file"
              accept={ACCEPT}
              className="hidden"
              aria-label="Proof file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                if (!isAllowedProofType(file.type)) {
                  toast.error('A proof must be a PDF or an image (PNG, JPEG or WebP).');
                  return;
                }
                upload.mutate(file);
              }}
            />
            <Button variant="secondary" size="sm" loading={upload.isPending} onClick={() => picker.current?.click()}>
              <Upload className="size-4" />
              {latest ? `Upload v${latest.version + 1}` : 'Upload proof'}
            </Button>
            {latest && !accepted && (
              <SendOnWhatsAppButton
                size="sm"
                what={`artwork proof v${latest.version}`}
                customerName={customerName}
                send={(to) => api.quoteAcceptance.sendProofOnWhatsApp(quoteId, { to })}
              />
            )}
          </>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        {response && (
          <div
            role="status"
            className={`flex items-start gap-2 rounded-lg p-3 text-sm ${
              response.kind === 'DECLINED' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'
            }`}
          >
            {response.kind === 'DECLINED' ? (
              <XCircle className="mt-0.5 size-4 shrink-0" />
            ) : (
              <MessageSquare className="mt-0.5 size-4 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="font-medium">
                {response.kind === 'DECLINED' ? 'Declined' : 'Changes requested'} by {response.byName}
                {response.at ? ` on ${formatDate(response.at)}` : ''}
              </p>
              {response.note && <p className="mt-1 whitespace-pre-line text-ink">{response.note}</p>}
              <p className="mt-1 text-ink-muted">Revise the quote and send the new version.</p>
            </div>
          </div>
        )}

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={data.proofRequired}
            disabled={!canEdit || accepted || rule.isPending}
            onChange={(event) => rule.mutate(event.target.checked)}
          />
          <span>
            <span className="block font-medium text-ink">Proof approval required before acceptance</span>
            <span className="block text-ink-muted">
              {data.proofRequiredFromDefault ? 'From your company settings. ' : ''}
              The customer can accept only after they approve the latest proof.
            </span>
          </span>
        </label>

        {data.proofs.length === 0 ? (
          <p className="text-sm text-ink-muted">No proof yet. Upload a PDF or image for the customer to approve.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {data.proofs.map((proof) => (
              <li key={proof.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-ink">Proof v{proof.version}</span>
                    <Badge tone={proof.supersededAt ? 'neutral' : TONE[proof.status]}>
                      {proof.supersededAt && proof.status === 'PENDING'
                        ? 'Replaced'
                        : QUOTE_PROOF_STATUS_LABELS[proof.status]}
                    </Badge>
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {proof.filename} · {formatDate(proof.createdAt)}
                    {proof.uploadedByName ? ` · ${proof.uploadedByName}` : ''}
                  </p>
                  {proof.respondedByName && (
                    <p className="text-xs text-ink-muted">
                      {proof.status === 'APPROVED' ? 'Approved' : 'Sent back'} by {proof.respondedByName}
                      {proof.respondedAt ? ` on ${formatDate(proof.respondedAt)}` : ''}
                    </p>
                  )}
                  {proof.responseComment && (
                    <p className="mt-1 whitespace-pre-line text-sm text-ink">“{proof.responseComment}”</p>
                  )}
                </div>
                {proof.fileAvailable && (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={open.isPending && open.variables === proof.attachmentId}
                    onClick={() => open.mutate(proof.attachmentId)}
                  >
                    Open
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
