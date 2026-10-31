'use client';

import { HelpCircle, ShieldAlert, TrendingUp } from 'lucide-react';
import type { GuardrailViolation, QuoteTotals } from '@saas/shared';
import { PERMISSIONS } from '@saas/shared';
import { useCan } from '@/lib/session-context';
import { cn } from '@/lib/utils';
import { formatCurrency } from './quote-lines-table';
import { MARGIN_TONE_CLASSES, type MarginStatus } from './margin-status';

interface QuoteMarginCardProps {
  totals: QuoteTotals;
  violations: GuardrailViolation[];
  status: MarginStatus;
  currency?: string;
}

/** The margin as a figure with its meaning beside it, never colour alone. */
export function MarginBadge({
  totals,
  status,
  className,
}: {
  totals: Pick<QuoteTotals, 'marginPct'>;
  status: MarginStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        MARGIN_TONE_CLASSES[status.tone],
        className,
      )}
    >
      {/* No figure before anything is priced, or while a line is re-costed. */}
      {status.showFigure ? (
        <>
          <span className="tabular-nums">{(totals.marginPct * 100).toFixed(1)}%</span>
          <span className="font-medium">· {status.label}</span>
        </>
      ) : (
        <span className="font-medium">{status.label}</span>
      )}
    </span>
  );
}

/**
 * Margin and anything blocking approval.
 *
 * Renders nothing without `quote:view_cost` — the API already strips cost from
 * the payload, so there would be no numbers to show, and an empty card reading
 * "0%" would be worse than no card at all.
 */
export function QuoteMarginCard({ totals, violations, status, currency = 'USD' }: QuoteMarginCardProps) {
  const canSeeCost = useCan({ permission: PERMISSIONS.QUOTE_VIEW_COST });
  if (!canSeeCost) return null;

  return (
    <div className="space-y-3 rounded-2xl border border-border/60 bg-surface p-4 shadow-[0_2px_10px_rgba(0,0,0,0.015)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
          <TrendingUp className="size-3.5" aria-hidden />
          Margin
        </h3>
        <MarginBadge totals={totals} status={status} />
      </div>

      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-ink-muted">Net revenue</dt>
          <dd className="tabular-nums text-ink">{formatCurrency(totals.subtotalAmount, currency)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-muted">Cost</dt>
          <dd className="tabular-nums text-ink">{status.showFigure ? formatCurrency(totals.costAmount, currency) : '—'}</dd>
        </div>
        <div className="flex justify-between border-t border-border/60 pt-1.5 font-semibold">
          <dt className="text-ink">Gross margin</dt>
          <dd className={cn('tabular-nums', status.showFigure && totals.marginAmount < 0 ? 'text-danger' : 'text-ink')}>
            {status.showFigure ? formatCurrency(totals.marginAmount, currency) : '—'}
          </dd>
        </div>
        {status.floor !== null && (
          <div className="flex justify-between text-xs">
            <dt className="text-ink-muted">Your margin floor</dt>
            <dd className="tabular-nums text-ink-muted">{(status.floor * 100).toFixed(1)}%</dd>
          </div>
        )}
      </dl>

      {/* Margin is against the untaxed subtotal — tax is collected for the
          state and is never margin. Worth saying once, on the card. */}
      {!totals.hasCompleteCost && (
        <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs leading-relaxed text-ink-muted">
          <HelpCircle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
          Some lines were typed by hand and have no cost, so this margin is an over-estimate. Add
          them from the catalog to make it real.
        </p>
      )}

      {violations.length > 0 && (
        <ul className="space-y-1.5">
          {violations.map((violation) => (
            <li
              key={`${violation.code}-${violation.lineId ?? 'quote'}`}
              className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2"
            >
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
              <span className="text-xs leading-relaxed text-ink-muted">
                {violation.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
