'use client';

import type { QuoteTotals } from '@saas/shared';
import { cn } from '@/lib/utils';
import { formatCurrency } from './quote-lines-table';

interface QuoteTotalsCardProps {
  totals: QuoteTotals;
  currency?: string;
  className?: string;
}

export function QuoteTotalsCard({
  totals,
  currency = 'USD',
  className,
}: QuoteTotalsCardProps) {
  const { subtotalAmount = 0, discountAmount = 0, taxAmount = 0, totalAmount = 0 } = totals;

  return (
    <div className={cn('flex justify-end', className)}>
      <div className="w-full max-w-sm rounded-2xl border border-border/80 bg-surface p-5 shadow-sm">
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-4 border-b border-border/60 pb-2">
          Financial Summary
        </h3>

        <dl className="space-y-2.5 text-sm">
          {/* Untaxed Amount / Subtotal */}
          <div className="flex items-center justify-between text-ink">
            <dt className="text-ink-muted">Untaxed Amount</dt>
            <dd className="font-medium tabular-nums">
              {formatCurrency(subtotalAmount, currency)}
            </dd>
          </div>

          {/* Discount if any */}
          {discountAmount > 0 && (
            <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
              <dt className="flex items-center gap-1.5 font-medium">
                <span>Total Discount</span>
              </dt>
              <dd className="font-semibold tabular-nums">
                -{formatCurrency(discountAmount, currency)}
              </dd>
            </div>
          )}

          {/* Taxes */}
          <div className="flex items-center justify-between text-ink">
            <dt className="text-ink-muted">Taxes</dt>
            <dd className="font-medium tabular-nums">
              {formatCurrency(taxAmount, currency)}
            </dd>
          </div>

          {/* Grand Total */}
          <div className="border-t border-border/80 pt-3 mt-2 flex items-baseline justify-between">
            <dt className="text-base font-semibold text-ink">
              Total ({currency.toUpperCase()})
            </dt>
            <dd className="text-xl font-bold tracking-tight text-ink tabular-nums">
              {formatCurrency(totalAmount, currency)}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
