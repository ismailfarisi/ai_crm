'use client';

import { Target, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DashboardGaugeWidgetProps {
  percentage?: number;
  targetPercentage?: number;
  title?: string;
  subtitle?: string;
  trendLabel?: string;
  className?: string;
}

export function DashboardGaugeWidget({
  percentage = 84,
  targetPercentage = 80,
  title = 'Quotation Win Rate',
  subtitle = 'Customer Satisfaction & Conversion',
  trendLabel = '+12.4% vs last month',
  className,
}: DashboardGaugeWidgetProps) {
  // Circular arc calculation (260 degree arc)
  const radius = 56;
  const strokeWidth = 10;
  const circumference = 2 * Math.PI * radius;
  // Arc length is ~75% of a full circle (270 degrees)
  const arcLength = circumference * 0.75;
  const strokeDashoffset = arcLength - (Math.min(Math.max(percentage, 0), 100) / 100) * arcLength;

  return (
    <div
      className={cn(
        'relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-xs transition-all hover:shadow-sm',
        className,
      )}
    >
      {/* Subtle warm ambient background glow */}
      <div className="pointer-events-none absolute -top-12 -right-12 size-36 rounded-full bg-amber-500/10 blur-2xl" />

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <Target className="size-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-ink">{title}</h3>
            <p className="text-[11px] text-ink-muted">{subtitle}</p>
          </div>
        </div>

        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/60 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:border-amber-900/50 dark:text-amber-300">
          <TrendingUp className="size-3" />
          {percentage >= targetPercentage ? 'Target Met' : 'In Progress'}
        </span>
      </div>

      {/* Gauge Visual Center */}
      <div className="relative my-3 flex items-center justify-center">
        <svg
          className="size-40 -rotate-135 transform"
          viewBox="0 0 140 140"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#F59E0B" />
              <stop offset="100%" stopColor="#D97706" />
            </linearGradient>
          </defs>

          {/* Background Track */}
          <circle
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeLinecap="round"
            className="stroke-amber-500/15 dark:stroke-amber-500/10"
          />

          {/* Golden Amber Progress Arc */}
          <circle
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke="url(#gaugeGradient)"
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>

        {/* Center Label & Number */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-3xl font-black tracking-tight tabular-nums text-ink">
            {percentage}%
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
            Success
          </span>
        </div>
      </div>

      {/* Footer Metrics Row */}
      <div className="flex items-center justify-between border-t border-border/60 pt-3 text-xs">
        <div className="flex items-center gap-1.5 text-ink-muted">
          <span className="size-1.5 rounded-full bg-amber-500" />
          <span>Goal: <strong className="font-medium text-ink">{targetPercentage}%</strong></span>
        </div>
        <span className="font-medium text-emerald-600 dark:text-emerald-400">
          {trendLabel}
        </span>
      </div>
    </div>
  );
}
