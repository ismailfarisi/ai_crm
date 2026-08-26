'use client';

import React from 'react';
import {
  TrendingUp,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  Calendar,
  Layers,
  ShoppingBag,
  Laptop,
  Plane,
  Briefcase,
  Users,
  Building,
  MoreVertical,
  Plus,
  Edit2,
  Trash2,
  Sliders,
  DollarSign,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import type { CategoryBudgetDto, BudgetPeriod } from '@saas/shared';

export interface BudgetMeterCardProps {
  budget: CategoryBudgetDto;
  isLoading?: boolean;
  onEdit?: (budget: CategoryBudgetDto) => void;
  onDelete?: (budget: CategoryBudgetDto) => void;
  onAdjust?: (budget: CategoryBudgetDto) => void;
  className?: string;
}

export interface BudgetGridProps {
  budgets?: CategoryBudgetDto[];
  isLoading?: boolean;
  onNewBudget?: () => void;
  onEditBudget?: (budget: CategoryBudgetDto) => void;
  onDeleteBudget?: (budget: CategoryBudgetDto) => void;
  title?: string;
  description?: string;
  className?: string;
}

export function formatBudgetCurrency(
  amount: number | null | undefined,
  currency: string = 'USD',
): string {
  const safeAmount = amount ?? 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safeAmount);
}

export function formatBudgetDateRange(startDate?: string, endDate?: string): string {
  if (!startDate || !endDate) return 'Ongoing Period';
  try {
    const s = new Date(startDate);
    const e = new Date(endDate);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return `${startDate} – ${endDate}`;
    const sStr = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const eStr = e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${sStr} – ${eStr}`;
  } catch {
    return `${startDate} – ${endDate}`;
  }
}

export function getCategoryBudgetMetadata(category: string) {
  const normalized = category.toLowerCase();
  if (normalized.includes('market') || normalized.includes('ad')) {
    return {
      icon: TrendingUp,
      badgeTone: 'info' as const,
      colorClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    };
  }
  if (normalized.includes('soft') || normalized.includes('saas') || normalized.includes('tech') || normalized.includes('cloud')) {
    return {
      icon: Laptop,
      badgeTone: 'brand' as const,
      colorClass: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
    };
  }
  if (normalized.includes('travel') || normalized.includes('flight') || normalized.includes('hotel')) {
    return {
      icon: Plane,
      badgeTone: 'warning' as const,
      colorClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    };
  }
  if (normalized.includes('office') || normalized.includes('suppl')) {
    return {
      icon: Building,
      badgeTone: 'neutral' as const,
      colorClass: 'bg-stone-500/10 text-stone-600 dark:text-stone-400 border-stone-500/20',
    };
  }
  if (normalized.includes('payroll') || normalized.includes('sal') || normalized.includes('contractor') || normalized.includes('people')) {
    return {
      icon: Users,
      badgeTone: 'success' as const,
      colorClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    };
  }
  return {
    icon: ShoppingBag,
    badgeTone: 'neutral' as const,
    colorClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  };
}

export function calculateBudgetStatus(
  spent: number,
  total: number,
  thresholdPercent: number = 85,
) {
  const percentage = total > 0 ? (spent / total) * 100 : 0;
  const remaining = total - spent;
  const isOverBudget = spent >= total;
  const isNearLimit = !isOverBudget && percentage >= thresholdPercent;
  const isHealthy = !isOverBudget && !isNearLimit;

  let meterColor = 'bg-emerald-500 dark:bg-emerald-400';
  let badgeTone: 'success' | 'warning' | 'danger' = 'success';
  let statusText = 'On Track';

  if (isOverBudget) {
    meterColor = 'bg-rose-500 dark:bg-rose-400';
    badgeTone = 'danger';
    statusText = 'Over Budget';
  } else if (isNearLimit) {
    meterColor = 'bg-amber-500 dark:bg-amber-400';
    badgeTone = 'warning';
    statusText = 'Near Limit';
  }

  return {
    percentage: Math.round(percentage * 10) / 10,
    clampedPercentage: Math.min(Math.max(percentage, 0), 100),
    remaining,
    isOverBudget,
    isNearLimit,
    isHealthy,
    meterColor,
    badgeTone,
    statusText,
  };
}

export function BudgetMeterCard({
  budget,
  isLoading = false,
  onEdit,
  onDelete,
  onAdjust,
  className,
}: BudgetMeterCardProps) {
  if (isLoading) {
    return (
      <div
        data-testid="budget-meter-loading"
        className={cn(
          'flex flex-col justify-between rounded-2xl border border-border/40 bg-surface/85 p-5 shadow-xs',
          className,
        )}
      >
        <div className="flex items-center justify-between">
          <Skeleton className="size-10 rounded-xl" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <div className="mt-4 space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-3 w-full rounded-full" />
          <Skeleton className="h-4 w-28" />
        </div>
      </div>
    );
  }

  const meta = getCategoryBudgetMetadata(budget.category);
  const Icon = meta.icon;
  const threshold = budget.alertThresholdPercent ?? 85;
  const status = calculateBudgetStatus(budget.spentAmount, budget.budgetAmount, threshold);

  return (
    <div
      data-testid={`budget-meter-card-${budget.id}`}
      className={cn(
        'group relative flex flex-col justify-between rounded-2xl border bg-surface/85 p-5 shadow-xs backdrop-blur-xs transition-all hover:border-border hover:shadow-sm',
        status.isOverBudget
          ? 'border-rose-500/30 bg-rose-500/5'
          : status.isNearLimit
          ? 'border-amber-500/30 bg-amber-500/5'
          : 'border-border/40',
        className,
      )}
    >
      {/* Header Row */}
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'grid size-10 place-items-center rounded-xl border transition-transform group-hover:scale-105',
                meta.colorClass,
              )}
            >
              <Icon className="size-5" />
            </div>
            <div>
              <h3
                data-testid={`budget-category-${budget.id}`}
                className="text-sm font-bold text-ink group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors"
              >
                {budget.category}
              </h3>
              <span
                data-testid={`budget-date-range-${budget.id}`}
                className="flex items-center gap-1 text-[11px] text-ink-subtle font-medium"
              >
                <Calendar className="size-3" />
                {formatBudgetDateRange(budget.startDate, budget.endDate)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Badge
              data-testid={`budget-period-badge-${budget.id}`}
              tone={meta.badgeTone}
              className="text-[10px] uppercase font-bold tracking-wider"
            >
              {budget.period}
            </Badge>

            {onEdit && (
              <button
                type="button"
                data-testid={`btn-edit-budget-${budget.id}`}
                onClick={() => onEdit(budget)}
                aria-label="Edit budget"
                className="rounded-lg p-1 text-ink-subtle hover:bg-surface-muted hover:text-ink cursor-pointer transition-colors"
              >
                <Edit2 className="size-3.5" />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                data-testid={`btn-delete-budget-${budget.id}`}
                onClick={() => onDelete(budget)}
                aria-label="Delete budget"
                className="rounded-lg p-1 text-ink-subtle hover:bg-surface-muted hover:text-rose-600 cursor-pointer transition-colors"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Spend Amounts */}
        <div className="mt-5">
          <div className="flex items-baseline justify-between gap-2">
            <span
              data-testid={`budget-spent-amount-${budget.id}`}
              className="text-2xl font-extrabold tracking-tight tabular-nums text-ink"
            >
              {formatBudgetCurrency(budget.spentAmount)}
            </span>
            <span
              data-testid={`budget-total-amount-${budget.id}`}
              className="text-xs font-semibold text-ink-muted tabular-nums"
            >
              cap: {formatBudgetCurrency(budget.budgetAmount)}
            </span>
          </div>

          {/* Meter Bar Container */}
          <div className="mt-3">
            <div
              data-testid={`budget-progress-container-${budget.id}`}
              className="relative h-3 w-full overflow-hidden rounded-full bg-surface-muted border border-border/20"
            >
              {/* Threshold Marker Indicator */}
              <div
                data-testid={`budget-threshold-marker-${budget.id}`}
                className="absolute top-0 bottom-0 z-10 w-0.5 bg-ink/30 dark:bg-ink/50"
                style={{ left: `${Math.min(threshold, 100)}%` }}
                title={`Alert Threshold: ${threshold}%`}
              />

              {/* Progress Fill */}
              <div
                data-testid={`budget-progress-bar-${budget.id}`}
                className={cn(
                  'h-full transition-all duration-500 rounded-full',
                  status.meterColor,
                )}
                style={{ width: `${status.clampedPercentage}%` }}
                role="progressbar"
                aria-valuenow={budget.spentAmount}
                aria-valuemin={0}
                aria-valuemax={budget.budgetAmount}
              />
            </div>

            {/* Threshold Label & Percentage */}
            <div className="mt-2 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 font-medium">
                {status.isOverBudget ? (
                  <span
                    data-testid={`status-badge-overbudget-${budget.id}`}
                    className="inline-flex items-center gap-1 font-bold text-rose-600 dark:text-rose-400"
                  >
                    <AlertOctagon className="size-3.5" />
                    Over Budget ({status.percentage}%)
                  </span>
                ) : status.isNearLimit ? (
                  <span
                    data-testid={`status-badge-warning-${budget.id}`}
                    className="inline-flex items-center gap-1 font-bold text-amber-600 dark:text-amber-400"
                  >
                    <AlertTriangle className="size-3.5" />
                    Near Cap ({status.percentage}%)
                  </span>
                ) : (
                  <span
                    data-testid={`status-badge-healthy-${budget.id}`}
                    className="inline-flex items-center gap-1 text-ink-muted"
                  >
                    <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                    {status.percentage}% spent
                  </span>
                )}
              </div>

              <span
                data-testid={`budget-remaining-${budget.id}`}
                className={cn(
                  'font-semibold tabular-nums',
                  status.remaining < 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-ink-muted',
                )}
              >
                {status.remaining < 0
                  ? `+${formatBudgetCurrency(Math.abs(status.remaining))} over`
                  : `${formatBudgetCurrency(status.remaining)} left`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer / Quick Adjust Button */}
      {onAdjust && (
        <div className="mt-4 flex items-center justify-end border-t border-border/25 pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid={`btn-adjust-budget-${budget.id}`}
            onClick={() => onAdjust(budget)}
            className="h-7 text-xs font-semibold text-ink-muted hover:text-ink"
          >
            <Sliders className="size-3 mr-1" />
            Adjust Cap
          </Button>
        </div>
      )}
    </div>
  );
}

export function BudgetGrid({
  budgets = [],
  isLoading = false,
  onNewBudget,
  onEditBudget,
  onDeleteBudget,
  title = 'Department & Category Budgets',
  description = 'Track live expenditures against allocated caps with dynamic threshold warnings.',
  className,
}: BudgetGridProps) {
  if (isLoading) {
    return (
      <div data-testid="budget-grid-loading" className={cn('space-y-4', className)}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1.5">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-80" />
          </div>
          <Skeleton className="h-9 w-32 rounded-full" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div
              key={idx}
              className="rounded-2xl border border-border/40 bg-surface/85 p-5 space-y-4"
            >
              <div className="flex justify-between">
                <Skeleton className="size-10 rounded-xl" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-3 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="budget-grid" className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <DollarSign className="size-4" />
            </span>
            <h2 className="text-lg font-bold tracking-tight text-ink sm:text-xl">{title}</h2>
          </div>
          {description && <p className="mt-1 text-xs text-ink-muted sm:text-sm">{description}</p>}
        </div>

        {onNewBudget && (
          <Button
            type="button"
            variant="primary"
            size="sm"
            data-testid="new-budget-btn"
            onClick={onNewBudget}
            className="font-semibold shadow-xs"
          >
            <Plus className="size-3.5" />
            New Budget Cap
          </Button>
        )}
      </div>

      {budgets.length === 0 ? (
        <div
          data-testid="budget-grid-empty"
          className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-surface/40 px-6 py-12 text-center"
        >
          <div className="grid size-12 place-items-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Layers className="size-6" />
          </div>
          <h3 className="mt-3 text-sm font-semibold text-ink">No category budgets created</h3>
          <p className="mt-1 max-w-sm text-xs text-ink-muted">
            Define departmental expense caps to monitor real-time company spend and receive alerts.
          </p>
          {onNewBudget && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onNewBudget}
              className="mt-4 font-semibold"
            >
              <Plus className="size-3.5" />
              Create First Budget
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {budgets.map((budget) => (
            <BudgetMeterCard
              key={budget.id}
              budget={budget}
              onEdit={onEditBudget}
              onDelete={onDeleteBudget}
            />
          ))}
        </div>
      )}
    </div>
  );
}
