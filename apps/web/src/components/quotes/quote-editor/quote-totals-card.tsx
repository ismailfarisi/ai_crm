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
    <div className={cn(className)}>
      <div className="h-full rounded-2xl border border-border/60 bg-surface p-4 sm:p-5 shadow-[0_2px_10px_rgba(0,0,0,0.015)] space-y-2.5 text-sm">
        <h3 className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-4 border-b border-border/60 pb-2">
          Totals
        </h3>

        {/*
          Read top to bottom, each row is the sum so far. The subtotal is
          already net of discount, so with a discount the lines' own total
          comes first and the discount comes off it; listing the discount after
          the subtotal made it look as if it had never been taken off.
        */}
        <dl className="space-y-2.5 text-sm">
          {discountAmount > 0 && (
            <>
              <div className="flex items-center justify-between text-ink">
                <dt className="text-ink-muted">Lines</dt>
                <dd className="font-medium tabular-nums">
                  {formatCurrency(subtotalAmount + discountAmount, currency)}
                </dd>
              </div>
              <div className="flex items-center justify-between text-ink">
                <dt className="text-ink-muted">Discount</dt>
                <dd className="font-medium tabular-nums">
                  −{formatCurrency(discountAmount, currency)}
                </dd>
              </div>
            </>
          )}

          <div className="flex items-center justify-between text-ink">
            <dt className="text-ink-muted">Subtotal before tax</dt>
            <dd className="font-medium tabular-nums">
              {formatCurrency(subtotalAmount, currency)}
            </dd>
          </div>

          {/* Taxes */}
          <div className="flex items-center justify-between text-ink">
            <dt className="text-ink-muted">VAT and taxes</dt>
            <dd className="font-medium tabular-nums">
              {formatCurrency(taxAmount, currency)}
            </dd>
          </div>

          {/* Grand Total */}
          <div className="border-t border-border/60 pt-3 mt-2 flex items-baseline justify-between">
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
