'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, TrendingUp, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DataPoint {
  month: string;
  value: number;
}

const DEFAULT_DATA: Record<'30D' | '90D' | '1Y', DataPoint[]> = {
  '30D': [
    { month: 'W1', value: 58 },
    { month: 'W2', value: 64 },
    { month: 'W3', value: 61 },
    { month: 'W4', value: 72.4 },
  ],
  '90D': [
    { month: 'May', value: 52 },
    { month: 'Jun', value: 63 },
    { month: 'Jul', value: 59 },
    { month: 'Aug', value: 72.4 },
  ],
  '1Y': [
    { month: 'Jan', value: 38 },
    { month: 'Feb', value: 45 },
    { month: 'Mar', value: 54 },
    { month: 'Apr', value: 49 },
    { month: 'May', value: 62 },
    { month: 'Jun', value: 68 },
    { month: 'Jul', value: 64 },
    { month: 'Aug', value: 72.4 },
  ],
};

export interface DashboardKpiChartProps {
  title?: string;
  metricLabel?: string;
  metricValue?: string;
  growthLabel?: string;
  className?: string;
}

export function DashboardKpiChart({
  title = 'Revenue & Conversion Velocity',
  metricLabel = 'Team Conversion KPI',
  metricValue = '72.4%',
  growthLabel = '+14.8% YoY',
  className,
}: DashboardKpiChartProps) {
  const [period, setPeriod] = useState<'30D' | '90D' | '1Y'>('1Y');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const data = DEFAULT_DATA[period];
  const width = 600;
  const height = 180;
  const paddingX = 30;
  const paddingY = 25;

  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingY * 2;

  // Calculate coordinates
  const points = data.map((d, i) => {
    const x = paddingX + (i / (data.length - 1)) * chartWidth;
    const y = paddingY + (1 - (d.value - 20) / 70) * chartHeight;
    return { x, y, ...d };
  });

  // Generate cubic bezier smooth curve
  const generateSplinePath = (pts: { x: number; y: number }[]) => {
    if (pts.length === 0) return '';
    let path = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i === 0 ? 0 : i - 1];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2 >= pts.length ? pts.length - 1 : i + 2];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    return path;
  };

  const linePath = generateSplinePath(points);
  const areaPath = points.length > 0
    ? `${linePath} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`
    : '';

  const activePoint = hoveredIndex !== null ? points[hoveredIndex] : points[points.length - 1];

  return (
    <div
      className={cn(
        'relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-xs transition-all',
        className,
      )}
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <Zap className="size-3.5" />
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              {title}
            </span>
          </div>

          <div className="mt-1 flex items-baseline gap-2.5">
            <h3 className="text-3xl font-extrabold tracking-tight text-ink tabular-nums">
              {metricValue}
            </h3>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="size-3" />
              {growthLabel}
            </span>
            <span className="hidden text-xs text-ink-muted sm:inline">• {metricLabel}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Time range pills */}
          <div className="flex items-center rounded-xl border border-border bg-surface-muted/60 p-0.5">
            {(['30D', '90D', '1Y'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setPeriod(t)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-semibold transition-all',
                  period === t
                    ? 'bg-surface text-ink shadow-2xs'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Jump Action Button */}
          <Link
            href="/quotes"
            className="grid size-8 place-items-center rounded-xl border border-border bg-surface-muted/60 text-ink-muted transition-all hover:border-brand hover:bg-brand-soft hover:text-brand"
            aria-label="View quotation analytics"
          >
            <ArrowUpRight className="size-4" />
          </Link>
        </div>
      </div>

      {/* Golden Wave SVG Chart */}
      <div className="relative mt-4 w-full">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-44 w-full overflow-visible"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="goldenAreaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.35" />
              <stop offset="60%" stopColor="#F59E0B" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="goldenStrokeGradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#F59E0B" />
              <stop offset="50%" stopColor="#FBBF24" />
              <stop offset="100%" stopColor="#D97706" />
            </linearGradient>
          </defs>

          {/* Subtle Horizontal Grid lines */}
          <line
            x1="0"
            y1={paddingY}
            x2={width}
            y2={paddingY}
            className="stroke-border/40"
            strokeDasharray="4 4"
            strokeWidth="1"
          />
          <line
            x1="0"
            y1={paddingY + chartHeight / 2}
            x2={width}
            y2={paddingY + chartHeight / 2}
            className="stroke-border/40"
            strokeDasharray="4 4"
            strokeWidth="1"
          />
          <line
            x1="0"
            y1={paddingY + chartHeight}
            x2={width}
            y2={paddingY + chartHeight}
            className="stroke-border/60"
            strokeWidth="1"
          />

          {/* Gradient Area Fill */}
          <path d={areaPath} fill="url(#goldenAreaGradient)" />

          {/* Spline Stroke Line */}
          <path
            d={linePath}
            fill="none"
            stroke="url(#goldenStrokeGradient)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-all duration-300"
          />

          {/* Highlight/Active Point */}
          {activePoint && (
            <g className="transition-all duration-200">
              {/* Vertical guideline */}
              <line
                x1={activePoint.x}
                y1={paddingY}
                x2={activePoint.x}
                y2={paddingY + chartHeight}
                className="stroke-amber-500/40"
                strokeDasharray="3 3"
                strokeWidth="1.5"
              />
              {/* Outer pulsing ring */}
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r="10"
                className="fill-amber-400/30 animate-pulse"
              />
              {/* Inner core circle */}
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r="5"
                className="fill-amber-500 stroke-2 stroke-surface"
              />
            </g>
          )}

          {/* Interactive touch/hover invisible hit areas */}
          {points.map((pt, i) => (
            <rect
              key={pt.month}
              x={pt.x - chartWidth / (data.length * 2)}
              y={0}
              width={chartWidth / data.length}
              height={height}
              fill="transparent"
              className="cursor-pointer"
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            />
          ))}
        </svg>

        {/* X-Axis Month Chips */}
        <div className="mt-2 flex items-center justify-between px-2 text-[11px] font-medium text-ink-subtle">
          {data.map((d, i) => (
            <span
              key={d.month}
              className={cn(
                'transition-colors',
                (hoveredIndex === i || (hoveredIndex === null && i === data.length - 1))
                  ? 'font-bold text-amber-700 dark:text-amber-400'
                  : 'text-ink-subtle',
              )}
            >
              {d.month}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
