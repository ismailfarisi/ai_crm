'use client';

import { HelpCircle, ShieldAlert, TrendingUp } from 'lucide-react';
import type { GuardrailViolation, QuoteTotals } from '@saas/shared';
import { PERMISSIONS } from '@saas/shared';
import { useCan } from '@/lib/session-context';
import { formatCurrency } from './quote-lines-table';

interface QuoteMarginCardProps {
  totals: QuoteTotals;
  violations: GuardrailViolation[];
  currency?: string;
}

/**
 * Margin and anything blocking approval.
 *
 * Renders nothing without `quote:view_cost` — the API already strips cost from
 * the payload, so there would be no numbers to show, and an empty card reading
 * "0%" would be worse than no card at all.
 */
export function QuoteMarginCard({ totals, violations, currency = 'USD' }: QuoteMarginCardProps) {
  const canSeeCost = useCan({ permission: PERMISSIONS.QUOTE_VIEW_COST });
  if (!canSeeCost) return null;

  const marginPct = totals.marginPct * 100;
  const isThin = violations.some((v) => v.code === 'MARGIN_BELOW_FLOOR');

  return (
    <div className="space-y-3 rounded-2xl border border-border/30 bg-surface/85 p-4 shadow-[0_2px_12px_rgba(0,0,0,0.015)]">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-ink-muted">
          <TrendingUp className="size-3.5" />
          Margin
        </h3>
        <span
          className={
            isThin
              ? 'rounded-full bg-danger-soft px-2 py-0.5 text-xs font-bold text-danger'
              : 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-400'
          }
        >
          {marginPct.toFixed(1)}%
        </span>
      </div>

      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-ink-muted">Net revenue</dt>
          <dd className="text-ink">{formatCurrency(totals.subtotalAmount, currency)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-muted">Cost</dt>
          <dd className="text-ink">{formatCurrency(totals.costAmount, currency)}</dd>
        </div>
        <div className="flex justify-between border-t border-border/30 pt-1.5 font-semibold">
          <dt className="text-ink">Gross margin</dt>
          <dd className="text-ink">{formatCurrency(totals.marginAmount, currency)}</dd>
        </div>
      </dl>

      {/* Margin is against the untaxed subtotal — tax is collected for the
          state and is never margin. Worth saying once, on the card. */}
      {!totals.hasCompleteCost && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
          <HelpCircle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
          Some lines were typed by hand and have no cost, so this margin is an over-estimate. Add
          them from the catalog to make it real.
        </p>
      )}

      {violations.length > 0 && (
        <ul className="space-y-1.5">
          {violations.map((violation) => (
            <li
              key={`${violation.code}-${violation.lineId ?? 'quote'}`}
              className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-soft/40 px-3 py-2"
            >
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-danger" />
              <span className="text-[11px] leading-relaxed text-ink-muted">
                {violation.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
