'use client';

import Link from 'next/link';
import { Briefcase } from 'lucide-react';
import { useSetJobLink } from '@/hooks/use-sales-orders';
import { JobPicker } from './job-picker';

/**
 * "For job" on a purchase order or a bill, changeable at any time: it is
 * management costing, so it never touches what was posted.
 */
export function JobLinkControl({
  kind,
  id,
  salesOrderId,
  canEdit,
  lockedReason,
}: {
  kind: 'purchaseOrder' | 'bill';
  id: string;
  salesOrderId: string | null | undefined;
  canEdit: boolean;
  /** Shown instead of the picker when the link is set somewhere else. */
  lockedReason?: string;
}) {
  const setJob = useSetJobLink(kind);
  if (!canEdit || lockedReason) {
    return (
      <p className="mb-3 flex items-center gap-1.5 text-sm text-ink-muted">
        <Briefcase className="size-4" aria-hidden />
        {salesOrderId ? (
          <>
            For job{' '}
            <Link className="font-medium text-ink underline underline-offset-2" href={`/orders/${salesOrderId}`}>
              the customer order
            </Link>
          </>
        ) : (
          'Not for a job'
        )}
        {lockedReason && <span className="text-ink-subtle">· {lockedReason}</span>}
      </p>
    );
  }
  return (
    <div className="mb-4 max-w-md">
      <JobPicker
        currentId={salesOrderId}
        value={salesOrderId ?? ''}
        disabled={setJob.isPending}
        onChange={(e) => setJob.mutate({ id, salesOrderId: e.target.value || null })}
      />
      {salesOrderId && (
        <Link
          className="mt-1 inline-block text-xs text-ink-muted underline underline-offset-2"
          href={`/orders/${salesOrderId}`}
        >
          Open the order’s profit
        </Link>
      )}
    </div>
  );
}
