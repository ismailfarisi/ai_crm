'use client';

import React, { useState, useMemo } from 'react';
import {
  Layers,
  Search,
  Plus,
  Calendar,
  CreditCard,
  Building2,
  DollarSign,
  TrendingUp,
  PauseCircle,
  PlayCircle,
  XCircle,
  Clock,
  CheckCircle2,
  AlertTriangle,
  MoreVertical,
  Edit2,
  Trash2,
  Sparkles,
  Server,
  Cloud,
  Laptop,
  ShieldCheck,
  Briefcase,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import type { RecurringExpenseDto, FinanceAccountDto } from '@saas/shared';
import { formatFinanceCurrency } from '../dashboard/treasury-stat-cards';

export interface SubscriptionsTableProps {
  subscriptions?: RecurringExpenseDto[];
  accounts?: FinanceAccountDto[];
  isLoading?: boolean;
  onNewSubscription?: () => void;
  onEditSubscription?: (subscription: RecurringExpenseDto) => void;
  onToggleStatus?: (
    subscription: RecurringExpenseDto,
    newStatus: 'ACTIVE' | 'PAUSED' | 'CANCELLED',
  ) => Promise<void> | void;
  onDeleteSubscription?: (subscription: RecurringExpenseDto) => Promise<void> | void;
  className?: string;
}

export function getVendorCategoryIcon(category: string, vendorName: string) {
  const normCat = category.toLowerCase();
  const normVen = vendorName.toLowerCase();

  if (normVen.includes('aws') || normVen.includes('cloud') || normVen.includes('gcp') || normVen.includes('azure')) {
    return Cloud;
  }
  if (normVen.includes('github') || normVen.includes('gitlab') || normVen.includes('vercel') || normVen.includes('dev')) {
    return Laptop;
  }
  if (normCat.includes('security') || normCat.includes('compliance')) {
    return ShieldCheck;
  }
  if (normCat.includes('infra') || normCat.includes('server') || normCat.includes('hosting')) {
    return Server;
  }
  if (normCat.includes('market') || normCat.includes('ad')) {
    return TrendingUp;
  }
  return Layers;
}

export function formatNextBillingDate(dateStr: string) {
  try {
    const target = new Date(dateStr);
    if (isNaN(target.getTime())) return { formatted: dateStr, badgeText: 'Scheduled', tone: 'neutral' as const };

    const formatted = target.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    const now = new Date();
    // Compare date parts
    const diffTime = target.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return { formatted, badgeText: 'Overdue', tone: 'danger' as const };
    }
    if (diffDays === 0) {
      return { formatted, badgeText: 'Due Today', tone: 'warning' as const };
    }
    if (diffDays === 1) {
      return { formatted, badgeText: 'Tomorrow', tone: 'warning' as const };
    }
    if (diffDays <= 7) {
      return { formatted, badgeText: `In ${diffDays} days`, tone: 'warning' as const };
    }
    return { formatted, badgeText: `In ${diffDays} days`, tone: 'neutral' as const };
  } catch {
    return { formatted: dateStr, badgeText: 'Scheduled', tone: 'neutral' as const };
  }
}

export function calculateNormalizedMonthlyCost(amount: number, interval: 'MONTHLY' | 'ANNUAL'): number {
  return interval === 'ANNUAL' ? amount / 12 : amount;
}

export function SubscriptionsTable({
  subscriptions = [],
  accounts = [],
  isLoading = false,
  onNewSubscription,
  onEditSubscription,
  onToggleStatus,
  onDeleteSubscription,
  className,
}: SubscriptionsTableProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'PAUSED' | 'CANCELLED'>('ALL');
  const [intervalFilter, setIntervalFilter] = useState<'ALL' | 'MONTHLY' | 'ANNUAL'>('ALL');

  // Accounts lookup map
  const accountsMap = useMemo(() => {
    const map = new Map<string, FinanceAccountDto>();
    accounts.forEach((acc) => map.set(acc.id, acc));
    return map;
  }, [accounts]);

  // Unique categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    subscriptions.forEach((s) => set.add(s.category));
    return Array.from(set);
  }, [subscriptions]);

  // Filtered subscriptions
  const filteredSubscriptions = useMemo(() => {
    return subscriptions.filter((sub) => {
      // Search match
      const matchSearch =
        !searchTerm.trim() ||
        sub.vendorName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sub.category.toLowerCase().includes(searchTerm.toLowerCase());

      // Category match
      const matchCategory = categoryFilter === 'ALL' || sub.category === categoryFilter;

      // Status match
      const matchStatus = statusFilter === 'ALL' || sub.status === statusFilter;

      // Interval match
      const matchInterval = intervalFilter === 'ALL' || sub.billingInterval === intervalFilter;

      return matchSearch && matchCategory && matchStatus && matchInterval;
    });
  }, [subscriptions, searchTerm, categoryFilter, statusFilter, intervalFilter]);

  // Metrics / KPIs
  const metrics = useMemo(() => {
    let monthlyRunRate = 0;
    let activeCount = 0;
    let upcomingDueCount = 0;
    const now = new Date();
    const next30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    subscriptions.forEach((sub) => {
      if (sub.status === 'ACTIVE') {
        activeCount++;
        monthlyRunRate += calculateNormalizedMonthlyCost(sub.amount, sub.billingInterval);

        try {
          const billingDate = new Date(sub.nextBillingDate);
          if (billingDate >= now && billingDate <= next30Days) {
            upcomingDueCount++;
          }
        } catch {
          // ignore
        }
      }
    });

    return {
      monthlyRunRate,
      annualRunRate: monthlyRunRate * 12,
      activeCount,
      totalCount: subscriptions.length,
      upcomingDueCount,
    };
  }, [subscriptions]);

  if (isLoading) {
    return (
      <div data-testid="subscriptions-loading-skeleton" className={cn('space-y-4', className)}>
        {/* KPI Skeleton */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="rounded-2xl border border-border/40 bg-surface/85 p-4 space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-7 w-36" />
            </div>
          ))}
        </div>

        {/* Toolbar Skeleton */}
        <div className="flex justify-between">
          <Skeleton className="h-10 w-64 rounded-xl" />
          <Skeleton className="h-10 w-32 rounded-xl" />
        </div>

        {/* Rows Skeleton */}
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="h-16 rounded-xl border border-border/40 bg-surface/85 p-4">
              <Skeleton className="h-full w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="subscriptions-container" className={cn('space-y-5', className)}>
      {/* Top Header & Action */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Layers className="size-4" />
            </span>
            <h2 className="text-lg font-bold tracking-tight text-ink sm:text-xl">
              Recurring Subscriptions & SaaS
            </h2>
          </div>
          <p className="mt-1 text-xs text-ink-muted sm:text-sm">
            Track vendor renewals, billing schedules, and monthly software burn rates.
          </p>
        </div>

        {onNewSubscription && (
          <Button
            type="button"
            variant="primary"
            size="sm"
            data-testid="btn-new-subscription"
            onClick={onNewSubscription}
            className="font-semibold shadow-xs"
          >
            <Plus className="size-3.5 mr-1" />
            Add Subscription
          </Button>
        )}
      </div>

      {/* KPI Metric Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Monthly Recurring Cost */}
        <div className="rounded-2xl border border-border/40 bg-surface/85 p-4 shadow-xs backdrop-blur-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ink-muted">Monthly SaaS Burn</span>
            <span className="grid size-8 place-items-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <DollarSign className="size-4" />
            </span>
          </div>
          <div className="mt-2">
            <span
              data-testid="kpi-monthly-burn"
              className="text-2xl font-extrabold tracking-tight text-ink tabular-nums"
            >
              {formatFinanceCurrency(metrics.monthlyRunRate)}
            </span>
            <p className="text-[11px] text-ink-subtle mt-0.5">
              Annualized: {formatFinanceCurrency(metrics.annualRunRate)}/yr
            </p>
          </div>
        </div>

        {/* Active Tools */}
        <div className="rounded-2xl border border-border/40 bg-surface/85 p-4 shadow-xs backdrop-blur-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ink-muted">Active Subscriptions</span>
            <span className="grid size-8 place-items-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <Layers className="size-4" />
            </span>
          </div>
          <div className="mt-2">
            <span
              data-testid="kpi-active-count"
              className="text-2xl font-extrabold tracking-tight text-ink tabular-nums"
            >
              {metrics.activeCount}
            </span>
            <p className="text-[11px] text-ink-subtle mt-0.5">
              of {metrics.totalCount} total registered services
            </p>
          </div>
        </div>

        {/* Upcoming Renewals */}
        <div className="rounded-2xl border border-border/40 bg-surface/85 p-4 shadow-xs backdrop-blur-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ink-muted">Renewals in 30 Days</span>
            <span className="grid size-8 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Clock className="size-4" />
            </span>
          </div>
          <div className="mt-2">
            <span
              data-testid="kpi-renewals-count"
              className="text-2xl font-extrabold tracking-tight text-ink tabular-nums"
            >
              {metrics.upcomingDueCount}
            </span>
            <p className="text-[11px] text-ink-subtle mt-0.5">Scheduled automated charges</p>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Search */}
        <div className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input
            id="input-search-subscriptions"
            data-testid="input-search-subscriptions"
            placeholder="Search vendor or category..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Category Select */}
          {categories.length > 0 && (
            <Select
              id="select-filter-subscription-category"
              data-testid="select-filter-subscription-category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              options={[
                { value: 'ALL', label: 'All Categories' },
                ...categories.map((c) => ({ value: c, label: c })),
              ]}
              containerClassName="w-40"
            />
          )}

          {/* Interval Select */}
          <Select
            id="select-filter-subscription-interval"
            data-testid="select-filter-subscription-interval"
            value={intervalFilter}
            onChange={(e) => setIntervalFilter(e.target.value as any)}
            options={[
              { value: 'ALL', label: 'All Intervals' },
              { value: 'MONTHLY', label: 'Monthly' },
              { value: 'ANNUAL', label: 'Annual' },
            ]}
            containerClassName="w-36"
          />

          {/* Status Tabs */}
          <div className="flex rounded-xl border border-border/40 bg-surface-muted/40 p-1">
            {(['ALL', 'ACTIVE', 'PAUSED', 'CANCELLED'] as const).map((st) => (
              <button
                key={st}
                type="button"
                data-testid={`status-tab-${st.toLowerCase()}`}
                onClick={() => setStatusFilter(st)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer',
                  statusFilter === st
                    ? 'bg-surface text-ink shadow-2xs font-bold'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {st === 'ALL' ? 'All' : st.charAt(0) + st.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Table or Empty State */}
      {filteredSubscriptions.length === 0 ? (
        <div
          data-testid="subscriptions-empty-state"
          className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-surface/40 px-6 py-12 text-center"
        >
          <div className="grid size-12 place-items-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Layers className="size-6" />
          </div>
          <h3 className="mt-3 text-sm font-semibold text-ink">No subscriptions found</h3>
          <p className="mt-1 max-w-sm text-xs text-ink-muted">
            {subscriptions.length === 0
              ? 'Add SaaS subscriptions and recurring vendor agreements to track billing cycles and costs.'
              : 'No recurring bills matched your search filters.'}
          </p>
          {onNewSubscription && subscriptions.length === 0 && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              data-testid="btn-empty-new-subscription"
              onClick={onNewSubscription}
              className="mt-4 font-semibold"
            >
              <Plus className="size-3.5 mr-1" />
              Add First Subscription
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/40 bg-surface/85 shadow-xs backdrop-blur-xs">
          <div className="overflow-x-auto">
            <table data-testid="subscriptions-table" className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border/30 bg-surface-muted/40 text-[11px] font-bold uppercase tracking-wider text-ink-subtle">
                  <th className="px-5 py-3.5">Vendor & Category</th>
                  <th className="px-5 py-3.5">Billing & Cost</th>
                  <th className="px-5 py-3.5">Payment Account</th>
                  <th className="px-5 py-3.5">Next Billing</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20 text-xs">
                {filteredSubscriptions.map((sub) => {
                  const Icon = getVendorCategoryIcon(sub.category, sub.vendorName);
                  const linkedAccount = sub.financeAccountId
                    ? accountsMap.get(sub.financeAccountId)
                    : null;
                  const billingInfo = formatNextBillingDate(sub.nextBillingDate);
                  const normalizedMonthly = calculateNormalizedMonthlyCost(
                    sub.amount,
                    sub.billingInterval,
                  );

                  return (
                    <tr
                      key={sub.id}
                      data-testid={`subscription-row-${sub.id}`}
                      className="group transition-colors hover:bg-surface-muted/30"
                    >
                      {/* Vendor & Category */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="grid size-9 place-items-center rounded-xl border border-border/30 bg-surface-muted/60 text-ink-muted group-hover:border-amber-500/40 transition-colors">
                            <Icon className="size-4" />
                          </div>
                          <div>
                            <span
                              data-testid={`sub-vendor-${sub.id}`}
                              className="font-bold text-ink group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors"
                            >
                              {sub.vendorName}
                            </span>
                            <div className="mt-0.5">
                              <span
                                data-testid={`sub-category-${sub.id}`}
                                className="text-[11px] text-ink-subtle"
                              >
                                {sub.category}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Billing & Cost */}
                      <td className="px-5 py-4">
                        <div>
                          <div className="flex items-baseline gap-1">
                            <span
                              data-testid={`sub-amount-${sub.id}`}
                              className="font-mono font-bold text-ink tabular-nums"
                            >
                              {formatFinanceCurrency(sub.amount)}
                            </span>
                            <span className="text-[10px] text-ink-subtle font-medium">
                              / {sub.billingInterval === 'ANNUAL' ? 'yr' : 'mo'}
                            </span>
                          </div>
                          {sub.billingInterval === 'ANNUAL' && (
                            <p className="font-mono text-[10px] text-ink-muted">
                              ~{formatFinanceCurrency(normalizedMonthly)}/mo
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Payment Account */}
                      <td className="px-5 py-4">
                        {linkedAccount ? (
                          <span
                            data-testid={`sub-account-${sub.id}`}
                            className="inline-flex items-center gap-1 font-medium text-ink"
                          >
                            <Building2 className="size-3 text-ink-subtle" />
                            {linkedAccount.name}
                          </span>
                        ) : (
                          <span
                            data-testid={`sub-account-${sub.id}`}
                            className="text-ink-subtle italic"
                          >
                            Unassigned
                          </span>
                        )}
                      </td>

                      {/* Next Billing */}
                      <td className="px-5 py-4">
                        <div>
                          <span
                            data-testid={`sub-next-date-${sub.id}`}
                            className="font-medium text-ink"
                          >
                            {billingInfo.formatted}
                          </span>
                          <div className="mt-0.5">
                            <Badge
                              data-testid={`sub-renewal-badge-${sub.id}`}
                              tone={billingInfo.tone}
                              className="text-[10px] py-0 font-semibold"
                            >
                              {billingInfo.badgeText}
                            </Badge>
                          </div>
                        </div>
                      </td>

                      {/* Status Badge */}
                      <td className="px-5 py-4">
                        <Badge
                          data-testid={`sub-status-${sub.id}`}
                          tone={
                            sub.status === 'ACTIVE'
                              ? 'success'
                              : sub.status === 'PAUSED'
                              ? 'warning'
                              : 'neutral'
                          }
                          className="text-[10px] uppercase font-bold tracking-wider"
                        >
                          {sub.status}
                        </Badge>
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {onToggleStatus && (
                            <button
                              type="button"
                              data-testid={`btn-toggle-status-${sub.id}`}
                              onClick={() => {
                                const nextStatus =
                                  sub.status === 'ACTIVE'
                                    ? 'PAUSED'
                                    : 'ACTIVE';
                                onToggleStatus(sub, nextStatus);
                              }}
                              title={sub.status === 'ACTIVE' ? 'Pause subscription' : 'Activate subscription'}
                              className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-ink transition-colors cursor-pointer"
                            >
                              {sub.status === 'ACTIVE' ? (
                                <PauseCircle className="size-4 text-amber-600 dark:text-amber-400" />
                              ) : (
                                <PlayCircle className="size-4 text-emerald-600 dark:text-emerald-400" />
                              )}
                            </button>
                          )}

                          {onEditSubscription && (
                            <button
                              type="button"
                              data-testid={`btn-edit-sub-${sub.id}`}
                              onClick={() => onEditSubscription(sub)}
                              aria-label="Edit subscription"
                              className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-ink transition-colors cursor-pointer"
                            >
                              <Edit2 className="size-4" />
                            </button>
                          )}

                          {onDeleteSubscription && (
                            <button
                              type="button"
                              data-testid={`btn-delete-sub-${sub.id}`}
                              onClick={() => onDeleteSubscription(sub)}
                              aria-label="Delete subscription"
                              className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-rose-600 transition-colors cursor-pointer"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
