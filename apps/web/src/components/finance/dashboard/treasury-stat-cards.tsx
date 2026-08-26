'use client';

import React from 'react';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Flame,
  Hourglass,
  ShieldCheck,
  AlertTriangle,
  AlertOctagon,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/primitives';
import type { TreasuryOverviewDto } from '@saas/shared';
import { calculateRunwayMonths } from '@saas/shared';

export interface TreasuryStatCardsProps {
  overview?: TreasuryOverviewDto | null;
  totalCash?: number;
  monthlyInflow?: number;
  monthlyOutflow?: number;
  monthlyBurnRate?: number;
  runwayMonths?: number;
  currency?: string;
  accountsCount?: number;
  isLoading?: boolean;
  className?: string;
}

export function formatFinanceCurrency(
  amount: number | null | undefined,
  currency: string = 'USD',
  options?: { decimals?: boolean; compact?: boolean },
): string {
  const decimals = options?.decimals ?? true;
  const compact = options?.compact ?? false;
  const value = typeof amount === 'number' && !Number.isNaN(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: decimals ? 2 : 0,
      maximumFractionDigits: decimals ? 2 : 0,
      notation: compact ? 'compact' : 'standard',
    }).format(value);
  } catch {
    return `$${value.toLocaleString(undefined, {
      minimumFractionDigits: decimals ? 2 : 0,
      maximumFractionDigits: decimals ? 2 : 0,
    })}`;
  }
}

export type RunwayHealthStatus = 'healthy' | 'warning' | 'critical' | 'infinite';

export interface RunwayHealthInfo {
  status: RunwayHealthStatus;
  badgeText: string;
  badgeTone: 'success' | 'warning' | 'danger';
  colorClasses: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

export function getRunwayHealthInfo(months: number, burnRate: number = 0): RunwayHealthInfo {
  if (!Number.isFinite(months) || months < 0 || burnRate <= 0) {
    return {
      status: 'infinite',
      badgeText: 'Self-Sustaining',
      badgeTone: 'success',
      colorClasses: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400',
      icon: ShieldCheck,
      description: 'Zero burn / Profitable',
    };
  }
  if (months >= 6) {
    return {
      status: 'healthy',
      badgeText: '> 6 mo • Healthy',
      badgeTone: 'success',
      colorClasses: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400',
      icon: ShieldCheck,
      description: 'Strong cash reserve',
    };
  }
  if (months >= 3) {
    return {
      status: 'warning',
      badgeText: '3–6 mo • Caution',
      badgeTone: 'warning',
      colorClasses: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400',
      icon: AlertTriangle,
      description: 'Moderate runway buffer',
    };
  }
  return {
    status: 'critical',
    badgeText: '< 3 mo • Critical',
    badgeTone: 'danger',
    colorClasses: 'bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400',
    icon: AlertOctagon,
    description: 'Urgent capital action required',
  };
}

export function TreasuryStatCards({
  overview,
  totalCash: propTotalCash,
  monthlyInflow: propMonthlyInflow,
  monthlyOutflow: propMonthlyOutflow,
  monthlyBurnRate: propMonthlyBurnRate,
  runwayMonths: propRunwayMonths,
  currency: propCurrency,
  accountsCount: propAccountsCount,
  isLoading = false,
  className,
}: TreasuryStatCardsProps) {
  if (isLoading) {
    return (
      <div
        data-testid="treasury-stat-cards-loading"
        className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4', className)}
      >
        {Array.from({ length: 4 }).map((_, idx) => (
          <div
            key={idx}
            className="flex flex-col justify-between rounded-2xl border border-border/40 bg-surface/85 p-5 shadow-xs"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="size-9 rounded-xl" />
            </div>
            <div className="mt-4 space-y-2">
              <Skeleton className="h-8 w-36" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const currency = propCurrency ?? overview?.currency ?? 'USD';
  const totalCash = propTotalCash ?? overview?.totalCash ?? 0;
  const monthlyInflow = propMonthlyInflow ?? overview?.monthlyInflow ?? 0;
  const monthlyOutflow = propMonthlyOutflow ?? overview?.monthlyOutflow ?? 0;
  const monthlyBurnRate = propMonthlyBurnRate ?? overview?.monthlyBurnRate ?? 0;
  const netCashflow = overview?.netCashflow ?? monthlyInflow - monthlyOutflow;

  const runwayMonths =
    propRunwayMonths !== undefined
      ? propRunwayMonths
      : overview?.runwayMonths !== undefined
        ? overview.runwayMonths
        : calculateRunwayMonths(totalCash, monthlyBurnRate);

  const accountsCount = propAccountsCount ?? overview?.accounts?.length ?? 0;
  const runwayHealth = getRunwayHealthInfo(runwayMonths, monthlyBurnRate);
  const RunwayIcon = runwayHealth.icon;

  const formattedRunway =
    !Number.isFinite(runwayMonths) || runwayMonths < 0
      ? '∞'
      : `${runwayMonths.toFixed(1)} mo`;

  return (
    <div
      data-testid="treasury-stat-cards"
      className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4', className)}
    >
      {/* 1. Total Available Cash Card */}
      <div
        data-testid="stat-card-total-cash"
        className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border/40 bg-surface/85 p-5 shadow-xs backdrop-blur-xs transition-all hover:border-border hover:shadow-sm"
      >
        <div className="flex items-start justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Total Available Cash
            </span>
            <div className="mt-2 flex items-baseline gap-1.5">
              <h3
                data-testid="total-cash-value"
                className="text-2xl font-extrabold tracking-tight text-ink tabular-nums sm:text-3xl"
              >
                {formatFinanceCurrency(totalCash, currency)}
              </h3>
            </div>
          </div>
          <div className="grid size-10 place-items-center rounded-xl bg-amber-500/10 text-amber-600 transition-transform group-hover:scale-105 dark:text-amber-400">
            <Wallet className="size-5" />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-border/30 pt-3 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1 font-medium">
            {accountsCount > 0
              ? `${accountsCount} active ${accountsCount === 1 ? 'account' : 'accounts'}`
              : 'Treasury reserve'}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-0.5 font-medium tabular-nums',
              netCashflow >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
            )}
          >
            {netCashflow >= 0 ? (
              <TrendingUp className="size-3.5" />
            ) : (
              <TrendingDown className="size-3.5" />
            )}
            {netCashflow >= 0 ? '+' : ''}
            {formatFinanceCurrency(netCashflow, currency, { compact: true })} net
          </span>
        </div>
      </div>

      {/* 2. Monthly Inflow & Outflow Card */}
      <div
        data-testid="stat-card-inflow-outflow"
        className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border/40 bg-surface/85 p-5 shadow-xs backdrop-blur-xs transition-all hover:border-border hover:shadow-sm"
      >
        <div className="flex items-start justify-between">
          <div className="w-full">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Monthly Cash Flow
            </span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {/* Inflow Badge */}
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2 transition-colors">
                <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  <ArrowDownRight className="size-3.5" />
                  Inflow
                </div>
                <div
                  data-testid="monthly-inflow-value"
                  className="mt-0.5 text-sm font-bold text-ink tabular-nums"
                >
                  +{formatFinanceCurrency(monthlyInflow, currency, { compact: false })}
                </div>
              </div>

              {/* Outflow Badge */}
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-2 transition-colors">
                <div className="flex items-center gap-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                  <ArrowUpRight className="size-3.5" />
                  Outflow
                </div>
                <div
                  data-testid="monthly-outflow-value"
                  className="mt-0.5 text-sm font-bold text-ink tabular-nums"
                >
                  -{formatFinanceCurrency(monthlyOutflow, currency, { compact: false })}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-border/30 pt-3 text-xs text-ink-muted">
          <span>Net 30-day velocity</span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-semibold',
              netCashflow >= 0
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
            )}
          >
            {netCashflow >= 0 ? 'Surplus' : 'Deficit'}
          </span>
        </div>
      </div>

      {/* 3. Monthly Burn Rate Card */}
      <div
        data-testid="stat-card-burn-rate"
        className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border/40 bg-surface/85 p-5 shadow-xs backdrop-blur-xs transition-all hover:border-border hover:shadow-sm"
      >
        <div className="flex items-start justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Monthly Burn Rate
            </span>
            <div className="mt-2 flex items-baseline gap-1.5">
              <h3
                data-testid="monthly-burn-rate-value"
                className="text-2xl font-extrabold tracking-tight text-ink tabular-nums sm:text-3xl"
              >
                {formatFinanceCurrency(monthlyBurnRate, currency)}
              </h3>
              <span className="text-xs font-medium text-ink-muted">/mo</span>
            </div>
          </div>
          <div className="grid size-10 place-items-center rounded-xl bg-orange-500/10 text-orange-600 transition-transform group-hover:scale-105 dark:text-orange-400">
            <Flame className="size-5" />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-border/30 pt-3 text-xs text-ink-muted">
          <span>Net operating burn</span>
          <span className="font-medium text-ink-muted">
            {monthlyBurnRate <= 0 ? 'Net Positive Cashflow' : 'Gross burn velocity'}
          </span>
        </div>
      </div>

      {/* 4. Runway Months Calculator Card */}
      <div
        data-testid="stat-card-runway"
        className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border/40 bg-surface/85 p-5 shadow-xs backdrop-blur-xs transition-all hover:border-border hover:shadow-sm"
      >
        <div className="flex items-start justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Estimated Runway
            </span>
            <div className="mt-2 flex items-baseline gap-2">
              <h3
                data-testid="runway-months-value"
                className="text-2xl font-extrabold tracking-tight text-ink tabular-nums sm:text-3xl"
              >
                {formattedRunway}
              </h3>
              <span
                data-testid="runway-health-badge"
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors',
                  runwayHealth.colorClasses,
                )}
              >
                <RunwayIcon className="size-3" />
                {runwayHealth.badgeText}
              </span>
            </div>
          </div>
          <div
            className={cn(
              'grid size-10 place-items-center rounded-xl transition-transform group-hover:scale-105',
              runwayHealth.status === 'healthy' || runwayHealth.status === 'infinite'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : runwayHealth.status === 'warning'
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
            )}
          >
            <Hourglass className="size-5" />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-border/30 pt-3 text-xs text-ink-muted">
          <span>{runwayHealth.description}</span>
          <span className="font-medium text-ink-subtle">
            {monthlyBurnRate > 0 ? `@ ${formatFinanceCurrency(monthlyBurnRate, currency, { compact: true })}/mo` : 'Self-funded'}
          </span>
        </div>
      </div>
    </div>
  );
}
