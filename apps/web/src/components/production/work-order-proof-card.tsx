'use client';

import { FileCheck2, TriangleAlert } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { QUOTE_PROOF_STATUS_LABELS } from '@saas/shared';
import { api } from '@/lib/api/endpoints';

/**
 * The artwork the customer approved, so the floor builds from that file and
 * not from whatever is in a chat thread. Shows nothing for jobs without a
 * quote or without proofs.
 */
export function WorkOrderProofCard({ workOrderId }: { workOrderId: string }) {
  const { data } = useQuery({
    queryKey: ['work-orders', workOrderId, 'proof'],
    queryFn: () => api.quoteAcceptance.workOrderProof(workOrderId),
    // The link inside is signed for minutes; fetch a fresh one before it lapses.
    refetchInterval: 4 * 60_000,
  });
  if (!data || (!data.proof && !data.newerVersion)) return null;
  const { proof, newerVersion } = data;
  const isImage = proof?.contentType.startsWith('image/');

  return (
    <section aria-labelledby="proof-heading" className="rounded-lg border border-border/60 bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="proof-heading" className="flex items-center gap-2 text-lg font-semibold text-ink">
          <FileCheck2 className="size-5 text-success" />
          {proof ? `Approved artwork · Proof v${proof.version}` : 'Artwork'}
        </h2>
        {proof?.url && (
          <a
            href={proof.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-medium text-ink hover:bg-surface-muted"
          >
            Open {isImage ? 'image' : 'PDF'}
          </a>
        )}
      </div>
      {proof && (
        <p className="mt-1 text-sm text-ink-muted">
          {proof.filename}
          {proof.approvedByName ? ` · approved by ${proof.approvedByName}` : ''}
          {proof.approvedAt ? ` on ${new Date(proof.approvedAt).toLocaleDateString()}` : ''}
          {data.quoteNumber ? ` · ${data.quoteNumber}` : ''}
        </p>
      )}
      {proof?.url && isImage && (
        // A signed link on the API's origin; next/image would try to proxy a private file.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={proof.url}
          alt={`Approved proof v${proof.version}`}
          className="mt-3 max-h-80 w-full rounded border border-border/60 bg-surface-muted object-contain"
        />
      )}
      {!proof && <p className="mt-1 text-sm text-ink-muted">No proof was approved for this job.</p>}
      {newerVersion && (
        <p role="status" className="mt-3 flex items-start gap-2 rounded bg-warning-soft p-2 text-sm text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          Proof v{newerVersion.version} is newer: {QUOTE_PROOF_STATUS_LABELS[newerVersion.status].toLowerCase()}. Check
          with sales before you build.
        </p>
      )}
    </section>
  );
}
