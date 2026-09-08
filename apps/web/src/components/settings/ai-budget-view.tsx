'use client';

import { useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Gauge, ShieldAlert } from 'lucide-react';
import { PERMISSIONS, type AiBudgetDto } from '@saas/shared';
import { calculateBudgetStatus, formatBudgetCurrency } from '@/components/finance/budgets/budget-meter-card';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Badge, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { useAiBudgetStatus, useAiUsage, useUpsertAiBudget } from '@/hooks/use-ai';

export function AiBudgetView() {
  const { data: status, isPending } = useAiBudgetStatus();
  const { data: usage, isPending: isUsagePending } = useAiUsage();
  const upsertBudget = useUpsertAiBudget();

  const [monthlyBudgetUsd, setMonthlyBudgetUsd] = useState('');
  const [alertThresholdPercent, setAlertThresholdPercent] = useState(80);
  const [isEnabled, setIsEnabled] = useState(true);

  // Sync the form with server data whenever it changes (e.g. after a save).
  // Adjusted during render (React re-renders before committing) rather than
  // in an effect, so no stale draft is ever painted — mirrors roles-view.tsx.
  const [lastSynced, setLastSynced] = useState<AiBudgetDto | null>(null);
  if (status?.budget && status.budget !== lastSynced) {
    setLastSynced(status.budget);
    setMonthlyBudgetUsd(String(status.budget.monthlyBudgetUsd));
    setAlertThresholdPercent(status.budget.alertThresholdPercent);
    setIsEnabled(status.budget.isEnabled);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(monthlyBudgetUsd);
    if (isNaN(amount) || amount <= 0) return;
    await upsertBudget.mutateAsync({
      monthlyBudgetUsd: amount,
      alertThresholdPercent,
      isEnabled,
    });
  };

  if (isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="AI Cost Guard" description="Monitor and cap AI spend for this organization." />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  const budgetStatus = status?.budget
    ? calculateBudgetStatus(
        status.currentSpendUsd,
        status.budget.monthlyBudgetUsd,
        status.budget.alertThresholdPercent,
      )
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Cost Guard"
        description="Monitor AI spend and set a monthly cap to prevent runaway usage."
      />

      {status?.budget ? (
        <div
          className={cn(
            'rounded-2xl border bg-surface/85 p-5 shadow-xs',
            budgetStatus?.isOverBudget
              ? 'border-rose-500/30 bg-rose-500/5'
              : budgetStatus?.isNearLimit
              ? 'border-amber-500/30 bg-amber-500/5'
              : 'border-border/40',
          )}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-2xl font-extrabold tracking-tight tabular-nums text-ink">
              {formatBudgetCurrency(status.currentSpendUsd)}
            </span>
            <span className="text-xs font-semibold text-ink-muted tabular-nums">
              cap: {formatBudgetCurrency(status.budget.monthlyBudgetUsd)}
            </span>
          </div>

          <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-surface-muted border border-border/20">
            <div
              className={cn('h-full rounded-full transition-all duration-500', budgetStatus?.meterColor)}
              style={{ width: `${budgetStatus?.clampedPercentage ?? 0}%` }}
              role="progressbar"
              aria-valuenow={status.currentSpendUsd}
              aria-valuemin={0}
              aria-valuemax={status.budget.monthlyBudgetUsd}
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-xs">
            {budgetStatus?.isOverBudget ? (
              <span className="inline-flex items-center gap-1 font-bold text-rose-600 dark:text-rose-400">
                <ShieldAlert className="size-3.5" />
                Over budget — AI calls are being blocked ({budgetStatus.percentage}%)
              </span>
            ) : budgetStatus?.isNearLimit ? (
              <span className="inline-flex items-center gap-1 font-bold text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-3.5" />
                Near cap ({budgetStatus.percentage}%)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-ink-muted">
                <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                {budgetStatus?.percentage ?? 0}% spent
              </span>
            )}
            {!status.budget.isEnabled && <Badge tone="neutral">Guard disabled</Badge>}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<Gauge className="size-8" />}
          title="No AI budget configured"
          description="Usage is currently unlimited. Set a monthly cap below to guard against runaway AI spend."
        />
      )}

      <Can permission={PERMISSIONS.AI_MANAGE}>
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-border/40 bg-surface/85 p-5 shadow-xs"
        >
          <h2 className="text-sm font-bold text-ink">Configure cap</h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="monthly-budget" className="block text-xs font-bold text-ink">
                Monthly budget ($)
              </label>
              <Input
                id="monthly-budget"
                type="number"
                step="0.01"
                min="1"
                placeholder="e.g. 100.00"
                value={monthlyBudgetUsd}
                onChange={(e) => setMonthlyBudgetUsd(e.target.value)}
                required
              />
            </div>

            <div>
              <label htmlFor="alert-threshold" className="block text-xs font-bold text-ink">
                Alert threshold: {alertThresholdPercent}%
              </label>
              <input
                id="alert-threshold"
                type="range"
                min="50"
                max="100"
                step="5"
                value={alertThresholdPercent}
                onChange={(e) => setAlertThresholdPercent(parseInt(e.target.value, 10))}
                className="mt-2.5 h-2 w-full cursor-pointer appearance-none rounded-lg bg-surface-muted accent-amber-500"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="guard-enabled"
              type="checkbox"
              className="size-4 rounded border-border accent-brand"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
            />
            <label htmlFor="guard-enabled" className="text-sm font-medium text-ink cursor-pointer">
              Enforce the cap (block AI calls once the budget is exceeded)
            </label>
          </div>

          {!isEnabled && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
              <AlertCircle className="size-4 shrink-0" />
              <span>Disabled — AI calls will not be blocked even over this cap.</span>
            </div>
          )}

          <div className="flex justify-end border-t border-border/25 pt-3">
            <Button type="submit" variant="primary" size="sm" loading={upsertBudget.isPending}>
              Save budget
            </Button>
          </div>
        </form>
      </Can>

      <div className="rounded-2xl border border-border/40 bg-surface/85 p-5 shadow-xs">
        <h2 className="mb-3 text-sm font-bold text-ink">Recent usage</h2>
        {isUsagePending ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : !usage?.length ? (
          <p className="text-xs text-ink-muted">No AI calls recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-ink-subtle">
                  <th className="pb-2 font-semibold">Feature</th>
                  <th className="pb-2 font-semibold">Model</th>
                  <th className="pb-2 font-semibold">Cost</th>
                  <th className="pb-2 font-semibold">Status</th>
                  <th className="pb-2 font-semibold">When</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((row) => (
                  <tr key={row.id} className="border-t border-border/20">
                    <td className="py-2 font-medium text-ink">{row.feature}</td>
                    <td className="py-2 text-ink-muted">{row.model}</td>
                    <td className="py-2 tabular-nums text-ink-muted">
                      {formatBudgetCurrency(row.estimatedCostUsd)}
                    </td>
                    <td className="py-2">
                      <Badge tone={row.success ? 'success' : 'danger'}>
                        {row.success ? 'ok' : row.errorMessage ?? 'failed'}
                      </Badge>
                    </td>
                    <td className="py-2 text-ink-subtle">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
