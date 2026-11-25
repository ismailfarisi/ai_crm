'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { QuoteDto } from '@saas/shared';
import { RecostDialog } from '@/components/catalog/material-cost-panel';
import { useQuoteCostCheck } from '@/hooks/use-catalog-admin';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/utils';

const pct = (n: number | null) => (n == null ? '—' : `${Math.round(n * 1000) / 10}%`);

/**
 * Shown on an open quote whose costs have moved in the catalog since it was
 * saved. Only for people who may see costs; the caller decides that.
 */
export function QuoteCostChangeBanner({
  quoteId,
  hasUnsavedChanges,
  onRecosted,
}: {
  quoteId: string;
  hasUnsavedChanges: boolean;
  onRecosted: (quote: QuoteDto) => void;
}) {
  const { data } = useQuoteCostCheck(quoteId);
  const [open, setOpen] = useState(false);
  if (!data?.moved) return null;
  const up = data.currentCost > data.savedCost;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning-soft/60 px-4 py-3"
      data-testid="quote-cost-change"
    >
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-ink">Costs have {up ? 'gone up' : 'come down'} since this quote was priced</p>
        <p className="text-ink-muted">
          It cost {formatMoney(data.savedCost, data.currency)}; at today&rsquo;s catalog it costs{' '}
          {formatMoney(data.currentCost, data.currency)}. At the same price your margin is {pct(data.currentMarginPct)}{' '}
          instead of {pct(data.savedMarginPct)}.
        </p>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        disabled={hasUnsavedChanges}
        title={hasUnsavedChanges ? 'Save your changes first' : undefined}
      >
        <RefreshCw className="size-4" />
        Re-cost
      </Button>
      {open && <RecostDialog check={data} onClose={() => setOpen(false)} onDone={onRecosted} />}
    </div>
  );
}
