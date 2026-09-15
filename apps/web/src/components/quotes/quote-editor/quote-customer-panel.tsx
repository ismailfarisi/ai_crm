'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copy, GitBranch, Link2, PackageCheck, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { PERMISSIONS, type QuoteStatus } from '@saas/shared';
import { api } from '@/lib/api/endpoints';
import { useQuoteSalesOrder } from '@/hooks/use-sales-orders';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';

interface QuoteCustomerPanelProps {
  quoteId: string;
  status: QuoteStatus;
  acceptedAt: string | null;
  acceptedByName: string | null;
  supersededAt: string | null;
  version: number;
}

/**
 * Everything that happens with the customer after the quote is written:
 * sending it for acceptance, revising it, and the order it became.
 */
export function QuoteCustomerPanel({
  quoteId,
  status,
  acceptedAt,
  acceptedByName,
  supersededAt,
  version,
}: QuoteCustomerPanelProps) {
  const router = useRouter();
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState<'link' | 'revise' | null>(null);
  const { data: orderResult } = useQuoteSalesOrder(quoteId, status === 'APPROVED');
  const order = orderResult?.order ?? null;

  const createLink = async () => {
    setBusy('link');
    try {
      const created = await api.quoteAcceptance.createLink(quoteId);
      setLink(created);
      try {
        await navigator.clipboard.writeText(created.url);
        toast.success('Acceptance link copied. Any earlier link no longer works.');
      } catch {
        toast.success('Acceptance link created');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the link');
    } finally {
      setBusy(null);
    }
  };

  const revise = async () => {
    setBusy('revise');
    try {
      const revision = await api.quoteAcceptance.revise(quoteId);
      toast.success(`Version ${revision.version ?? version + 1} created as a draft`);
      router.push(`/quotes/${revision.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not revise the quote');
    } finally {
      setBusy(null);
    }
  };

  if (supersededAt) {
    return (
      <div className="rounded-2xl border border-border/40 bg-surface-muted px-4 py-3 text-sm text-ink-muted">
        This is version {version}. It was replaced by a newer revision on{' '}
        {new Date(supersededAt).toLocaleDateString()} and can no longer be accepted or approved.
      </div>
    );
  }

  return (
    <section
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/40 bg-surface px-4 py-3 shadow-2xs"
      aria-label="Customer"
    >
      <div className="flex min-w-0 items-center gap-2 text-sm">
        {acceptedAt ? (
          <>
            <UserCheck className="size-4 shrink-0 text-success" />
            <span className="text-ink">
              Accepted by <strong>{acceptedByName}</strong> on {new Date(acceptedAt).toLocaleDateString()}
            </span>
          </>
        ) : (
          <>
            <Link2 className="size-4 shrink-0 text-ink-subtle" />
            <span className="text-ink-muted">
              {version > 1 ? `Version ${version}. ` : ''}Not yet accepted by the customer.
            </span>
          </>
        )}
        {link && (
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(link.url).then(() => toast.success('Copied'))}
            className="inline-flex max-w-full items-center gap-1 truncate rounded bg-surface-sunk px-2 py-0.5 font-mono text-xs text-ink-muted hover:text-ink"
            title={`Expires ${new Date(link.expiresAt).toLocaleDateString()}`}
          >
            <Copy className="size-3 shrink-0" />
            <span className="truncate">{link.url}</span>
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {order && (
          <Link
            href={`/orders/${order.id}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/40 px-3 py-1.5 text-xs font-semibold text-accent hover:border-border"
          >
            <PackageCheck className="size-4" />
            {order.orderNumber}
          </Link>
        )}
        {!acceptedAt && status !== 'REJECTED' && (
          <Can permission={PERMISSIONS.QUOTE_UPDATE}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={busy === 'link'}
              disabled={busy !== null}
              onClick={createLink}
              className="rounded-full px-4 text-xs gap-1.5"
            >
              <Link2 className="size-4" />
              {link ? 'New link' : 'Get acceptance link'}
            </Button>
          </Can>
        )}
        {status !== 'APPROVED' && (
          <Can permission={PERMISSIONS.QUOTE_CREATE}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={busy === 'revise'}
              disabled={busy !== null}
              onClick={revise}
              className="rounded-full px-4 text-xs gap-1.5"
            >
              <GitBranch className="size-4" />
              Revise
            </Button>
          </Can>
        )}
      </div>
    </section>
  );
}
