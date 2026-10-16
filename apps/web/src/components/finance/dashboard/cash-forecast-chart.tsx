'use client';

import React, { useMemo } from 'react';
import { CalendarRange, Layers } from 'lucide-react';
import type { CashForecastDto } from '@saas/shared';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/primitives';
import { formatFinanceCurrency } from './treasury-stat-cards';

export interface CashForecastChartProps {
  forecast?: CashForecastDto | null;
  title?: string;
  isLoading?: boolean;
  className?: string;
}

function monthLabel(ym: string): string {
  const d = new Date(`${ym}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ym;
  return d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}

const W = 720;
const H = 260;
const PAD_L = 55;
const PAD_R = 30;
const PAD_T = 25;
const PAD_B = 40;

/**
 * The next few months of cash: money expected in (up), bills and recurring
 * commitments going out (down, stacked), and the closing balance as a line.
 * Colours are the same emerald/rose/ink tokens as the trend chart above it.
 */
export function CashForecastChart({
  forecast,
  title = 'Next 6 months',
  isLoading = false,
  className,
}: CashForecastChartProps) {
  const currency = forecast?.baseCurrency || 'USD';
  const months = useMemo(() => forecast?.months ?? [], [forecast]);

  const geometry = useMemo(() => {
    const cw = W - PAD_L - PAD_R;
    const ch = H - PAD_T - PAD_B;
    const maxUp = Math.max(0, ...months.flatMap((m) => [m.inflows, m.closing]));
    const maxDown = Math.max(0, ...months.flatMap((m) => [m.billsOut + m.recurringOut + m.payrollOut, -m.closing]));
    const top = maxUp || 1;
    const bottom = -maxDown;
    const span = top - bottom || 1;
    const y = (v: number) => PAD_T + ((top - v) / span) * ch;
    const slot = cw / (months.length || 1);
    const barW = Math.max(10, Math.min(28, slot * 0.3));
    const points = months.map((m, i) => ({
      m,
      cx: PAD_L + (i + 0.5) * slot,
      inflowY: y(m.inflows),
      billsBottom: y(-m.billsOut),
      recurringBottom: y(-(m.billsOut + m.recurringOut)),
      payrollBottom: y(-(m.billsOut + m.recurringOut + m.payrollOut)),
      closingY: y(m.closing),
    }));
    return { ch, barW, points, zeroY: y(0) };
  }, [months]);

  if (isLoading) {
    return (
      <div
        data-testid="cash-forecast-loading"
        className={cn('rounded-2xl border border-border/40 bg-surface/85 p-6 shadow-xs', className)}
      >
        <Skeleton className="h-5 w-48" />
        <Skeleton className="mt-6 h-52 w-full rounded-xl" />
      </div>
    );
  }

  const hasData = months.some((m) => m.inflows !== 0 || m.billsOut !== 0 || m.recurringOut !== 0 || m.payrollOut !== 0 || m.closing !== 0);
  const last = months[months.length - 1];
  const compact = (n: number) => formatFinanceCurrency(n, currency, { compact: true });
  const summary = hasData
    ? `Cash forecast for the next ${months.length} months in ${currency}. ${months
        .map(
          (m) =>
            `${monthLabel(m.month)}: in ${compact(m.inflows)}, out ${compact(m.billsOut + m.recurringOut + m.payrollOut)} (bills ${compact(m.billsOut)}, recurring ${compact(m.recurringOut)}, payroll ${compact(m.payrollOut)}), closing ${compact(m.closing)}`,
        )
        .join('. ')}.`
    : 'No forecast cash movements.';

  const { ch, barW, points, zeroY } = geometry;
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.cx} ${p.closingY}`).join(' ');

  return (
    <div
      data-testid="cash-forecast-chart"
      className={cn(
        'relative flex flex-col overflow-hidden rounded-2xl border border-border/40 bg-surface/85 p-5 shadow-xs sm:p-6',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <CalendarRange className="size-4" />
        </span>
        <div>
          <h3 className="text-base font-bold tracking-tight text-ink sm:text-lg">{title}</h3>
          <p className="text-xs text-ink-muted sm:text-sm">
            Expected cash in and out, in {currency}
            {last && hasData && <> · closing {compact(last.closing)}</>}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 border-y border-border/30 py-2.5 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-emerald-500" /> Inflows
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-rose-500" /> Bills
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-rose-300 dark:bg-rose-800" /> Recurring
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-violet-500" /> Payroll
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1 w-3 rounded-full bg-ink" /> Closing balance
        </span>
      </div>

      <div className="mt-4 w-full">
        {!hasData ? (
          <div
            data-testid="cash-forecast-empty"
            className="flex h-52 flex-col items-center justify-center text-center text-ink-muted"
          >
            <Layers className="size-8 text-ink-subtle" />
            <p className="mt-2 text-sm font-medium">Nothing forecast for the next months</p>
          </div>
        ) : (
          <svg
            role="img"
            aria-labelledby="cash-forecast-title cash-forecast-desc"
            viewBox={`0 0 ${W} ${H}`}
            className="h-56 w-full overflow-visible select-none sm:h-64"
            preserveAspectRatio="none"
          >
            <title id="cash-forecast-title">{title}</title>
            <desc id="cash-forecast-desc">{summary}</desc>
            <line x1={PAD_L} x2={W - PAD_R} y1={zeroY} y2={zeroY} className="stroke-border" strokeWidth="1" />
            <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={PAD_T + ch} className="stroke-border/50" strokeWidth="1" />
            {points.map((p) => (
              <g key={p.m.month}>
                <rect
                  x={p.cx - barW / 2}
                  y={p.inflowY}
                  width={barW}
                  height={Math.max(0, zeroY - p.inflowY)}
                  rx="3"
                  className="fill-emerald-500"
                />
                <rect
                  x={p.cx - barW / 2}
                  y={zeroY}
                  width={barW}
                  height={Math.max(0, p.billsBottom - zeroY)}
                  className="fill-rose-500"
                />
                <rect
                  x={p.cx - barW / 2}
                  y={p.billsBottom}
                  width={barW}
                  height={Math.max(0, p.recurringBottom - p.billsBottom)}
                  className="fill-rose-300 dark:fill-rose-800"
                />
                <rect
                  x={p.cx - barW / 2}
                  y={p.recurringBottom}
                  width={barW}
                  height={Math.max(0, p.payrollBottom - p.recurringBottom)}
                  className="fill-violet-500"
                />
                <text x={p.cx} y={H - 12} textAnchor="middle" className="fill-ink-subtle text-[11px] font-medium">
                  {monthLabel(p.m.month)}
                </text>
              </g>
            ))}
            <path
              d={linePath}
              fill="none"
              className="stroke-ink"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {points.map((p) => (
              <circle
                key={`c-${p.m.month}`}
                cx={p.cx}
                cy={p.closingY}
                r="3.5"
                className="fill-ink stroke-surface"
                strokeWidth="1.5"
              >
                <title>{`${monthLabel(p.m.month)} closing ${formatFinanceCurrency(p.m.closing, currency)}`}</title>
              </circle>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}
