'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import { cn, formatMoney } from '@/lib/utils';
import type { RevenueMonth } from './dashboard-figures';

const PERIODS = [
  { key: '1M', label: 'This month', months: 1, previous: 'last month' },
  { key: '3M', label: '3 months', months: 3, previous: 'the 3 months before' },
  { key: '12M', label: '12 months', months: 12, previous: 'the 12 months before' },
] as const;

type PeriodKey = (typeof PERIODS)[number]['key'];

export interface DashboardKpiChartProps {
  /**
   * Real monthly figures, oldest first, in the base currency. Give it twice
   * the longest period (24 months) so each period has one to compare against.
   * There is no sample fallback: this chart used to draw an invented curve for
   * every account, including one created seconds earlier.
   */
  series?: RevenueMonth[];
  currency?: string | null;
  title?: string;
  /** What the figures leave out, such as invoices in other currencies. */
  note?: string;
  className?: string;
}

const sum = (months: RevenueMonth[]) => months.reduce((acc, m) => acc + m.value, 0);

/**
 * Invoiced revenue by month, as bars: one bar per month, its value read out on
 * hover or keyboard focus, and the period's total with the change on the
 * period before it. The badge is green only when the figure went up.
 */
export function DashboardKpiChart({
  series = [],
  currency,
  title = 'Invoiced revenue',
  note,
  className,
}: DashboardKpiChartProps) {
  const [periodKey, setPeriodKey] = useState<PeriodKey>('12M');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const period = PERIODS.find((p) => p.key === periodKey) ?? PERIODS[2];

  const current = series.slice(-period.months);
  const previous = series.slice(-period.months * 2, -period.months);
  const total = sum(current);
  const previousTotal = sum(previous);
  const growth =
    previous.length === period.months && previousTotal > 0
      ? Math.round(((total - previousTotal) / previousTotal) * 1000) / 10
      : null;

  // "This month" alone is one bar, so last month stands beside it for scale.
  const bars = period.months === 1 ? series.slice(-2) : current;
  const firstCurrent = bars.length - current.length;
  const peak = Math.max(...bars.map((b) => b.value), 0);
  const hasData = series.some((m) => m.value !== 0);
  const money = (n: number) => formatMoney(n, currency, { decimals: 0 });
  const active = activeIndex !== null ? bars[activeIndex] : null;

  const GrowthIcon = growth === null || growth === 0 ? Minus : growth > 0 ? TrendingUp : TrendingDown;
  const growthTone = growth === null || growth === 0 ? 'neutral' : growth > 0 ? 'success' : 'danger';

  return (
    <section
      aria-labelledby="revenue-chart-title"
      className={cn('flex flex-col rounded-2xl border border-border bg-surface p-5 shadow-xs', className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="revenue-chart-title" className="text-sm font-semibold text-ink">
            {title}
          </h2>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <p className="text-2xl font-semibold tracking-tight tabular-nums text-ink" data-testid="revenue-total">
              {money(total)}
            </p>
            {growth !== null && (
              <Badge tone={growthTone} className="gap-1" data-testid="revenue-growth">
                <GrowthIcon className="size-3" aria-hidden />
                {growth > 0 ? '+' : ''}
                {growth}% on {period.previous}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-ink-muted">
            {period.months === 1 ? 'Invoiced this month' : `Invoiced in the last ${period.label}`}
            {note ? `. ${note}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div role="group" aria-label="Period" className="flex items-center rounded-full border border-border bg-surface-muted p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={periodKey === p.key}
                onClick={() => {
                  setPeriodKey(p.key);
                  setActiveIndex(null);
                }}
                className={cn(
                  'min-h-8 rounded-full px-3 text-xs font-semibold transition-colors cursor-pointer',
                  periodKey === p.key ? 'bg-surface text-ink shadow-2xs' : 'text-ink-muted hover:text-ink',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Link
            href="/invoices"
            aria-label="Open invoices"
            title="Open invoices"
            className="grid size-8 place-items-center rounded-full border border-border bg-surface text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <ArrowUpRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>

      {!hasData ? (
        <div data-testid="kpi-chart-empty" className="flex h-44 flex-col items-center justify-center gap-1 text-center">
          <p className="text-sm font-medium text-ink">Nothing invoiced yet</p>
          <p className="max-w-xs text-xs text-ink-muted">Revenue appears here once your first invoice is issued.</p>
        </div>
      ) : (
        <div className="mt-4">
          {/* The value of the bar under the pointer or the keyboard. */}
          <p aria-live="polite" className="h-5 text-xs text-ink-muted tabular-nums" data-testid="revenue-readout">
            {active ? (
              <>
                <span className="font-medium text-ink">{active.label}</span> · {money(active.value)}
              </>
            ) : (
              'Point at or tab to a month to see its figure.'
            )}
          </p>
          <ul
            aria-label={`${title} by month`}
            className="mt-2 flex h-40 items-end gap-0.5 border-b border-border-strong"
            onMouseLeave={() => setActiveIndex(null)}
          >
            {bars.map((bar, i) => {
              const height = peak > 0 ? (bar.value / peak) * 100 : 0;
              // The month in hand leads; pointing at another month moves the lead to it.
              const isActive = activeIndex === null ? i === bars.length - 1 : activeIndex === i;
              const isComparison = i < firstCurrent;
              return (
                <li key={bar.label} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                  <button
                    type="button"
                    aria-label={`${bar.label}: ${money(bar.value)}${isComparison ? ' (last month, for comparison)' : ''}`}
                    onMouseEnter={() => setActiveIndex(i)}
                    onFocus={() => setActiveIndex(i)}
                    onBlur={() => setActiveIndex(null)}
                    className="group flex h-full w-full flex-col justify-end px-px cursor-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring rounded-t"
                  >
                    <span
                      className={cn(
                        'block w-full rounded-t transition-colors',
                        bar.value > 0 && 'min-h-0.5',
                        isActive ? 'bg-ink' : isComparison ? 'bg-border-strong' : 'bg-ink-subtle',
                      )}
                      style={{ height: `${height}%` }}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-1.5 flex gap-0.5" aria-hidden>
            {bars.map((bar, i) => (
              <span
                key={bar.label}
                className={cn(
                  'min-w-0 flex-1 truncate text-center text-[11px]',
                  (activeIndex === null ? i === bars.length - 1 : activeIndex === i) ? 'font-semibold text-ink' : 'text-ink-subtle',
                )}
              >
                {bar.month}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
