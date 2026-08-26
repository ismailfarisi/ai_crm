'use client';

import React, { useState, useMemo } from 'react';
import {
  TrendingUp,
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/primitives';
import { formatFinanceCurrency } from './treasury-stat-cards';

export interface CashflowDataPoint {
  date: string;
  inflow: number;
  outflow: number;
  net?: number;
  label?: string;
}

export interface CashflowTrendChartProps {
  series?: CashflowDataPoint[];
  currency?: string;
  title?: string;
  description?: string;
  isLoading?: boolean;
  className?: string;
  onPeriodChange?: (period: '7D' | '30D' | '90D') => void;
  defaultPeriod?: '7D' | '30D' | '90D';
}

const DEFAULT_SAMPLE_SERIES: Record<'7D' | '30D' | '90D', CashflowDataPoint[]> = {
  '7D': [
    { date: 'Mon', label: 'Day 1', inflow: 14200, outflow: 8400, net: 5800 },
    { date: 'Tue', label: 'Day 2', inflow: 22500, outflow: 11200, net: 11300 },
    { date: 'Wed', label: 'Day 3', inflow: 18900, outflow: 14500, net: 4400 },
    { date: 'Thu', label: 'Day 4', inflow: 31000, outflow: 16800, net: 14200 },
    { date: 'Fri', label: 'Day 5', inflow: 27400, outflow: 19300, net: 8100 },
    { date: 'Sat', label: 'Day 6', inflow: 12100, outflow: 5200, net: 6900 },
    { date: 'Sun', label: 'Day 7', inflow: 9800, outflow: 4100, net: 5700 },
  ],
  '30D': [
    { date: 'W1', label: 'Week 1', inflow: 58400, outflow: 34200, net: 24200 },
    { date: 'W2', label: 'Week 2', inflow: 74200, outflow: 42100, net: 32100 },
    { date: 'W3', label: 'Week 3', inflow: 63800, outflow: 48900, net: 14900 },
    { date: 'W4', label: 'Week 4', inflow: 91500, outflow: 52400, net: 39100 },
  ],
  '90D': [
    { date: 'Month 1', label: 'Month 1', inflow: 220000, outflow: 145000, net: 75000 },
    { date: 'Month 2', label: 'Month 2', inflow: 265000, outflow: 168000, net: 97000 },
    { date: 'Month 3', label: 'Month 3', inflow: 312000, outflow: 184000, net: 128000 },
  ],
};

export function CashflowTrendChart({
  series,
  currency = 'USD',
  title = 'Cashflow Runway & Velocity',
  description = 'Inflow vs Outflow bars with Net Cashflow trajectory curve',
  isLoading = false,
  className,
  onPeriodChange,
  defaultPeriod = '30D',
}: CashflowTrendChartProps) {
  const [period, setPeriod] = useState<'7D' | '30D' | '90D'>(defaultPeriod);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const activeSeries = useMemo<CashflowDataPoint[]>(() => {
    if (series !== undefined) {
      return series.map((pt) => ({
        ...pt,
        net: pt.net !== undefined ? pt.net : pt.inflow - pt.outflow,
      }));
    }
    return DEFAULT_SAMPLE_SERIES[period];
  }, [series, period]);

  const handlePeriodChange = (newPeriod: '7D' | '30D' | '90D') => {
    setPeriod(newPeriod);
    setHoveredIndex(null);
    onPeriodChange?.(newPeriod);
  };

  // Aggregates
  const totals = useMemo(() => {
    return activeSeries.reduce(
      (acc, curr) => ({
        inflow: acc.inflow + curr.inflow,
        outflow: acc.outflow + curr.outflow,
        net: acc.net + (curr.net ?? curr.inflow - curr.outflow),
      }),
      { inflow: 0, outflow: 0, net: 0 },
    );
  }, [activeSeries]);

  if (isLoading) {
    return (
      <div
        data-testid="cashflow-chart-loading"
        className={cn(
          'relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border/40 bg-surface/85 p-6 shadow-xs',
          className,
        )}
      >
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-8 w-28 rounded-xl" />
        </div>
        <div className="mt-6">
          <Skeleton className="h-52 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  // SVG Chart Geometry
  const viewBoxWidth = 720;
  const viewBoxHeight = 260;
  const paddingLeft = 55;
  const paddingRight = 30;
  const paddingTop = 25;
  const paddingBottom = 45;

  const chartWidth = viewBoxWidth - paddingLeft - paddingRight;
  const chartHeight = viewBoxHeight - paddingTop - paddingBottom;

  // Calculate scales
  const maxSeriesVal = Math.max(
    ...activeSeries.map((d) => Math.max(d.inflow, d.outflow, Math.abs(d.net ?? 0))),
    1000,
  );
  // Round up to nice ceiling (e.g. nearest 10,000 or 5,000)
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxSeriesVal)));
  const yMax = Math.ceil((maxSeriesVal * 1.15) / magnitude) * magnitude || 10000;

  const dataCount = activeSeries.length;
  const slotWidth = chartWidth / (dataCount || 1);
  const barWidth = Math.max(6, Math.min(18, slotWidth * 0.28));
  const barGap = Math.max(2, barWidth * 0.2);

  // Map points for spline net line and bars
  const chartPoints = activeSeries.map((d, idx) => {
    const slotCenterX = paddingLeft + (idx + 0.5) * slotWidth;
    const inflowHeight = Math.max(2, (d.inflow / yMax) * chartHeight);
    const outflowHeight = Math.max(2, (d.outflow / yMax) * chartHeight);

    const inflowY = paddingTop + chartHeight - inflowHeight;
    const outflowY = paddingTop + chartHeight - outflowHeight;

    const netValue = d.net ?? d.inflow - d.outflow;
    // Map net value from 0 to yMax
    const netY = paddingTop + chartHeight - (Math.max(0, netValue) / yMax) * chartHeight;

    return {
      ...d,
      slotCenterX,
      inflowHeight,
      outflowHeight,
      inflowY,
      outflowY,
      inflowX: slotCenterX - barWidth - barGap / 2,
      outflowX: slotCenterX + barGap / 2,
      netX: slotCenterX,
      netY,
      netValue,
    };
  });

  // Spline Path Generation
  const generateSplinePath = (pts: { netX: number; netY: number }[]) => {
    if (pts.length === 0) return '';
    if (pts.length === 1) return `M ${pts[0].netX} ${pts[0].netY}`;
    let path = `M ${pts[0].netX} ${pts[0].netY}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i === 0 ? 0 : i - 1];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2 >= pts.length ? pts.length - 1 : i + 2];

      const cp1x = p1.netX + (p2.netX - p0.netX) / 6;
      const cp1y = p1.netY + (p2.netY - p0.netY) / 6;
      const cp2x = p2.netX - (p3.netX - p1.netX) / 6;
      const cp2y = p2.netY - (p3.netY - p1.netY) / 6;

      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.netX} ${p2.netY}`;
    }
    return path;
  };

  const netSplinePath = generateSplinePath(chartPoints);

  const activePoint =
    hoveredIndex !== null && hoveredIndex >= 0 && hoveredIndex < chartPoints.length
      ? chartPoints[hoveredIndex]
      : null;

  return (
    <div
      data-testid="cashflow-trend-chart"
      className={cn(
        'group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border/40 bg-surface/85 p-5 shadow-xs backdrop-blur-xs transition-all hover:border-border hover:shadow-sm sm:p-6',
        className,
      )}
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <TrendingUp className="size-4" />
            </span>
            <h3 className="text-base font-bold tracking-tight text-ink sm:text-lg">{title}</h3>
          </div>
          {description && (
            <p className="mt-1 text-xs text-ink-muted sm:text-sm">{description}</p>
          )}
        </div>

        {/* Action Controls & Period Toggle */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Period selector */}
          <div
            data-testid="period-toggle"
            className="flex items-center rounded-xl border border-border/50 bg-surface-muted/60 p-0.5"
          >
            {(['7D', '30D', '90D'] as const).map((t) => (
              <button
                key={t}
                type="button"
                data-testid={`period-btn-${t}`}
                onClick={() => handlePeriodChange(t)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer',
                  period === t
                    ? 'bg-surface text-ink shadow-2xs'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Legend & Aggregate Summary Bar */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-border/30 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          {/* Inflow indicator */}
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-emerald-500" />
            <span className="font-medium text-ink-muted">Inflow</span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
              +{formatFinanceCurrency(totals.inflow, currency, { compact: true })}
            </span>
          </div>

          {/* Outflow indicator */}
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-rose-500" />
            <span className="font-medium text-ink-muted">Outflow</span>
            <span className="font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
              -{formatFinanceCurrency(totals.outflow, currency, { compact: true })}
            </span>
          </div>

          {/* Net Flow curve indicator */}
          <div className="flex items-center gap-1.5">
            <span className="h-1 w-3 rounded-full bg-amber-500" />
            <span className="font-medium text-ink-muted">Net Cashflow</span>
            <span
              className={cn(
                'font-bold tabular-nums',
                totals.net >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400',
              )}
            >
              {totals.net >= 0 ? '+' : ''}
              {formatFinanceCurrency(totals.net, currency, { compact: true })}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 text-[11px] text-ink-subtle">
          <Calendar className="size-3" />
          <span>Active Window: {period}</span>
        </div>
      </div>

      {/* Interactive SVG Chart */}
      <div className="relative mt-4 w-full">
        {activeSeries.length === 0 ? (
          <div
            data-testid="chart-empty-state"
            className="flex h-52 flex-col items-center justify-center text-center text-ink-muted"
          >
            <Layers className="size-8 text-ink-subtle" />
            <p className="mt-2 text-sm font-medium">No cashflow data available for this range</p>
          </div>
        ) : (
          <>
            <svg
              data-testid="cashflow-svg"
              viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
              className="h-56 w-full overflow-visible select-none sm:h-64"
              preserveAspectRatio="none"
            >
              <defs>
                {/* Inflow gradient */}
                <linearGradient id="inflowBarGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10B981" stopOpacity="0.95" />
                  <stop offset="100%" stopColor="#059669" stopOpacity="0.7" />
                </linearGradient>

                {/* Outflow gradient */}
                <linearGradient id="outflowBarGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F43F5E" stopOpacity="0.95" />
                  <stop offset="100%" stopColor="#E11D48" stopOpacity="0.7" />
                </linearGradient>

                {/* Net Spline Gradient */}
                <linearGradient id="netStrokeGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#F59E0B" />
                  <stop offset="50%" stopColor="#FBBF24" />
                  <stop offset="100%" stopColor="#D97706" />
                </linearGradient>
              </defs>

              {/* Horizontal Grid lines & Y-Axis values */}
              {[1, 0.66, 0.33, 0].map((ratio) => {
                const y = paddingTop + (1 - ratio) * chartHeight;
                const valueLabel = formatFinanceCurrency(yMax * ratio, currency, {
                  compact: true,
                  decimals: false,
                });
                return (
                  <g key={ratio} className="transition-opacity">
                    <line
                      x1={paddingLeft}
                      y1={y}
                      x2={viewBoxWidth - paddingRight}
                      y2={y}
                      className={cn(
                        'stroke-border/40',
                        ratio === 0 ? 'stroke-border/70 stroke-1' : 'stroke-dasharray-4 stroke-1',
                      )}
                      strokeDasharray={ratio === 0 ? undefined : '3 3'}
                    />
                    <text
                      x={paddingLeft - 8}
                      y={y + 3.5}
                      textAnchor="end"
                      className="fill-ink-subtle text-[10px] font-medium"
                    >
                      {valueLabel}
                    </text>
                  </g>
                );
              })}

              {/* Render Bars (Inflow & Outflow) */}
              {chartPoints.map((pt, idx) => {
                const isHovered = hoveredIndex === idx;
                return (
                  <g
                    key={`bars-${idx}`}
                    className="transition-all duration-200"
                    opacity={hoveredIndex !== null && !isHovered ? 0.45 : 1}
                  >
                    {/* Inflow Bar */}
                    <rect
                      x={pt.inflowX}
                      y={pt.inflowY}
                      width={barWidth}
                      height={pt.inflowHeight}
                      rx="3"
                      fill="url(#inflowBarGrad)"
                      className="transition-all duration-150"
                    />

                    {/* Outflow Bar */}
                    <rect
                      x={pt.outflowX}
                      y={pt.outflowY}
                      width={barWidth}
                      height={pt.outflowHeight}
                      rx="3"
                      fill="url(#outflowBarGrad)"
                      className="transition-all duration-150"
                    />
                  </g>
                );
              })}

              {/* Net Spline Curve */}
              <path
                d={netSplinePath}
                fill="none"
                stroke="url(#netStrokeGrad)"
                strokeWidth="2.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition-all duration-300"
              />

              {/* Net Data Points */}
              {chartPoints.map((pt, idx) => {
                const isHovered = hoveredIndex === idx;
                return (
                  <g key={`net-point-${idx}`}>
                    <circle
                      cx={pt.netX}
                      cy={pt.netY}
                      r={isHovered ? 5 : 3.5}
                      className={cn(
                        'transition-all duration-200',
                        isHovered
                          ? 'fill-amber-500 stroke-2 stroke-surface'
                          : 'fill-amber-400 stroke-1.5 stroke-surface',
                      )}
                    />
                  </g>
                );
              })}

              {/* Active Hover Guideline & Highlight Halo */}
              {activePoint && (
                <g data-testid="chart-active-indicator" className="pointer-events-none transition-all">
                  <line
                    x1={activePoint.slotCenterX}
                    y1={paddingTop}
                    x2={activePoint.slotCenterX}
                    y2={paddingTop + chartHeight}
                    className="stroke-amber-500/50"
                    strokeDasharray="3 3"
                    strokeWidth="1.5"
                  />
                  <circle
                    cx={activePoint.netX}
                    cy={activePoint.netY}
                    r="10"
                    className="fill-amber-400/25 animate-pulse"
                  />
                  <circle
                    cx={activePoint.netX}
                    cy={activePoint.netY}
                    r="5.5"
                    className="fill-amber-500 stroke-2 stroke-surface"
                  />
                </g>
              )}

              {/* X-Axis Date Labels */}
              {chartPoints.map((pt, idx) => {
                const isHovered = hoveredIndex === idx;
                return (
                  <text
                    key={`label-${idx}`}
                    x={pt.slotCenterX}
                    y={viewBoxHeight - paddingBottom + 18}
                    textAnchor="middle"
                    className={cn(
                      'text-[11px] transition-colors',
                      isHovered
                        ? 'fill-amber-700 font-bold dark:fill-amber-400'
                        : 'fill-ink-subtle font-medium',
                    )}
                  >
                    {pt.date}
                  </text>
                );
              })}

              {/* Invisible interactive hover hit targets */}
              {chartPoints.map((pt, idx) => (
                <rect
                  key={`hit-${idx}`}
                  data-testid={`chart-hit-area-${idx}`}
                  x={paddingLeft + idx * slotWidth}
                  y={paddingTop}
                  width={slotWidth}
                  height={chartHeight + 20}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onClick={() => setHoveredIndex(idx === hoveredIndex ? null : idx)}
                />
              ))}
            </svg>

            {/* Hover Tooltip Overlay */}
            {activePoint && (
              <div
                data-testid="cashflow-tooltip"
                className="pointer-events-none absolute z-20 flex flex-col gap-1 rounded-xl border border-border/80 bg-surface/95 p-3 shadow-lg backdrop-blur-md transition-all duration-150 text-xs"
                style={{
                  left: `${Math.max(10, Math.min(85, (activePoint.slotCenterX / viewBoxWidth) * 100))}%`,
                  top: '10px',
                  transform: 'translateX(-50%)',
                }}
              >
                <div className="font-semibold text-ink border-b border-border/40 pb-1 flex items-center justify-between gap-3">
                  <span>{activePoint.label || activePoint.date}</span>
                  <span className="text-[10px] text-ink-subtle uppercase">Details</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1">
                  <span className="text-ink-muted">Inflow:</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400 text-right tabular-nums">
                    +{formatFinanceCurrency(activePoint.inflow, currency)}
                  </span>

                  <span className="text-ink-muted">Outflow:</span>
                  <span className="font-semibold text-rose-600 dark:text-rose-400 text-right tabular-nums">
                    -{formatFinanceCurrency(activePoint.outflow, currency)}
                  </span>

                  <span className="text-ink-muted border-t border-border/30 pt-1 font-medium">Net:</span>
                  <span
                    className={cn(
                      'border-t border-border/30 pt-1 font-bold text-right tabular-nums',
                      activePoint.netValue >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400',
                    )}
                  >
                    {activePoint.netValue >= 0 ? '+' : ''}
                    {formatFinanceCurrency(activePoint.netValue, currency)}
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
