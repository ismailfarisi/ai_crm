'use client';

import { calculateQuoteTotals, type CostingPolicy } from '@saas/shared';
import type { Quote } from '@/hooks/use-quotes';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn, formatMoney } from '@/lib/utils';
import { linesWithoutCost, MARGIN_TONE_CLASSES, marginStatus } from './quote-editor/margin-status';

export type QuoteDecision = 'APPROVE' | 'REJECT';

interface QuoteDecisionDialogProps {
  quote: Quote | null;
  action: QuoteDecision | null;
  onClose: () => void;
  /** Sends the signal. A rejection keeps the dialog open with the error in it. */
  onConfirm: (quote: Quote, action: QuoteDecision) => Promise<unknown>;
  /** Margin is shown only to someone who may see cost. */
  canSeeCost: boolean;
  policy?: CostingPolicy | null;
}

const pct = (fraction: number) => `${Math.round(fraction * 1000) / 10}%`;

/**
 * Approve or reject from a list, with the figures the decision rests on: the
 * total, and for someone who may see cost, the margin judged against the floor.
 * Approving from a row used to take one click and show nothing at all.
 */
export function QuoteDecisionDialog({
  quote,
  action,
  onClose,
  onConfirm,
  canSeeCost,
  policy,
}: QuoteDecisionDialogProps) {
  if (!quote || !action) return null;

  const name = quote.quoteNumber || quote.title || 'this quote';
  const approving = action === 'APPROVE';
  const items = quote.items ?? [];
  const totals = calculateQuoteTotals(items);
  const margin = marginStatus(totals, policy, linesWithoutCost(items));

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={() => onConfirm(quote, action)}
      title={approving ? `Approve ${name}?` : `Reject ${name}?`}
      description={
        approving
          ? 'Approving locks the price. The customer can then accept it, and that raises the sales order.'
          : 'The quote goes back to its author. It can be changed and submitted again.'
      }
      confirmLabel={approving ? 'Approve quote' : 'Reject quote'}
      tone={approving ? 'primary' : 'danger'}
    >
      <dl className="space-y-2 rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-muted">Customer</dt>
          <dd className="truncate text-ink">{quote.customerName || 'No customer'}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-muted">Total</dt>
          <dd className="font-semibold tabular-nums text-ink">
            {formatMoney(Number(quote.totalAmount) || 0, quote.currency)}
          </dd>
        </div>
        {canSeeCost && (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-ink-muted">Margin</dt>
            <dd className="flex items-center gap-2">
              {margin.showFigure && (
                <span className="font-semibold tabular-nums text-ink">{pct(totals.marginPct)}</span>
              )}
              <span
                data-testid="decision-margin-status"
                className={cn(
                  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
                  MARGIN_TONE_CLASSES[margin.tone],
                )}
              >
                {margin.label}
              </span>
            </dd>
          </div>
        )}
      </dl>
    </ConfirmDialog>
  );
}
