'use client';

import React, { Fragment, useState, useMemo } from 'react';
import Link from 'next/link';
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
  Server,
  Cloud,
  Laptop,
  ShieldCheck,
  Briefcase,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { monthlyEquivalent, type RecurringExpenseDto, type RecurringInterval, type FinanceAccountDto } from '@saas/shared';
import { useRecurringOccurrences } from '@/hooks/use-finance';
import { INTERVAL_LABEL } from './subscription-form-modal';
import { useOrganization } from '@/hooks/use-organization';
import { formatFinanceCurrency, OtherCurrencies, splitByBase, totalsByCurrency } from '../money';

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

export function calculateNormalizedMonthlyCost(amount: number, interval: RecurringInterval): number {
  return monthlyEquivalent(amount, interval);
}

const INTERVAL_SUFFIX: Record<RecurringInterval, string> = {
  MONTHLY: 'mo',
  QUARTERLY: 'qtr',
  SEMI_ANNUAL: '6 mo',
  ANNUAL: 'yr',
};

/** Past its end date by the time the next bill would fall due: nothing more will be created. */
export function hasEnded(sub: RecurringExpenseDto): boolean {
  return Boolean(sub.endDate) && sub.endDate! <= sub.nextBillingDate;
}

function OccurrencesPanel({ id, currency }: { id: string; currency: string }) {
  const { data = [], isLoading, isError } = useRecurringOccurrences(id);

  return (
    <div data-testid={`occurrences-${id}`} className="px-5 py-3">
      {isLoading ? (
        <Skeleton className="h-8 w-full" />
      ) : isError ? (
        <p className="text-xs text-danger">Could not load the bill history.</p>
      ) : data.length === 0 ? (
        <p className="text-xs text-ink-muted">No bills created yet.</p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              <th className="py-1.5 pr-4">Period</th>
              <th className="py-1.5 pr-4">Amount</th>
              <th className="py-1.5 pr-4">Status</th>
              <th className="py-1.5">Bill</th>
            </tr>
          </thead>
          <tbody>
            {data.map((o) => (
              <tr key={o.id} data-testid={`occurrence-${o.id}`}>
                <td className="py-1.5 pr-4">
                  {o.periodStart} to {o.periodEnd}
                </td>
                <td className="py-1.5 pr-4 font-mono tabular-nums">{formatFinanceCurrency(o.amount, currency)}</td>
                <td className="py-1.5 pr-4">
                  <Badge tone={o.status === 'FAILED' ? 'danger' : 'success'} className="text-[11px]">
                    {o.status === 'FAILED' ? 'Failed' : 'Generated'}
                  </Badge>
                  {o.error && <span className="ml-2 text-danger">{o.error}</span>}
                </td>
                <td className="py-1.5">
                  {o.billId ? (
                    <Link href={`/purchasing/bills/${o.billId}`} className="font-medium text-ink hover:underline">
                      {o.billNumber ?? 'View bill'}
                    </Link>
                  ) : (
                    <span className="text-ink-subtle">None</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
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
  const [intervalFilter, setIntervalFilter] = useState<'ALL' | RecurringInterval>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // A schedule bills in its supplier's currency, or the base currency without one.
  const base = useOrganization().data?.baseCurrency ?? '';
  const currencyOf = (sub: RecurringExpenseDto) => sub.currency || base;

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
    let activeCount = 0;
    let upcomingDueCount = 0;
    const now = new Date();
    const next30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    subscriptions.forEach((sub) => {
      if (sub.status === 'ACTIVE') {
        activeCount++;

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

    // Monthly costs are only added within a currency.
    const monthly = splitByBase(
      totalsByCurrency(
        subscriptions.filter((s) => s.status === 'ACTIVE'),
        (s) => calculateNormalizedMonthlyCost(s.amount, s.billingInterval),
        (s) => s.currency || base,
      ),
      base,
    );

    return {
      monthly,
      activeCount,
      totalCount: subscriptions.length,
      upcomingDueCount,
    };
  }, [subscriptions, base]);

  if (isLoading) {
    return (
      <div data-testid="subscriptions-loading-skeleton" className={cn('space-y-4', className)}>
        {/* KPI Skeleton */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="rounded-2xl border border-border/40 bg-surface p-4 space-y-2">
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
            <div key={idx} className="h-16 rounded-xl border border-border/40 bg-surface p-4">
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
            <span className="grid size-7 place-items-center rounded-lg bg-surface-muted text-ink-muted">
              <Layers className="size-4" />
            </span>
            <h2 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">
              Recurring Subscriptions & SaaS
            </h2>
          </div>
          <p className="mt-1 text-xs text-ink-muted sm:text-sm">
            Each schedule raises a supplier bill on its billing date.
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
        <div className="rounded-2xl border border-border/40 bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ink-muted">Monthly cost</span>
            <span className="grid size-8 place-items-center rounded-lg bg-surface-muted text-ink-muted">
              <DollarSign className="size-4" />
            </span>
          </div>
          <div className="mt-2">
            <span
              data-testid="kpi-monthly-burn"
              className="text-2xl font-semibold tracking-tight text-ink tabular-nums"
            >
              {formatFinanceCurrency(metrics.monthly.base, base)}
            </span>
            <p className="text-[11px] text-ink-subtle mt-0.5 tabular-nums">
              {formatFinanceCurrency(metrics.monthly.base * 12, base)} a year
            </p>
            <OtherCurrencies others={metrics.monthly.others} className="mt-0.5 text-[11px] text-ink-muted" />
          </div>
        </div>

        {/* Active Tools */}
        <div className="rounded-2xl border border-border/40 bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ink-muted">Active Subscriptions</span>
            <span className="grid size-8 place-items-center rounded-lg bg-surface-muted text-ink-muted">
              <Layers className="size-4" />
            </span>
          </div>
          <div className="mt-2">
            <span
              data-testid="kpi-active-count"
              className="text-2xl font-semibold tracking-tight text-ink tabular-nums"
            >
              {metrics.activeCount}
            </span>
            <p className="text-[11px] text-ink-subtle mt-0.5">
              of {metrics.totalCount} total registered services
            </p>
          </div>
        </div>

        {/* Upcoming Renewals */}
        <div className="rounded-2xl border border-border/40 bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ink-muted">Renewals in 30 Days</span>
            <span className="grid size-8 place-items-center rounded-lg bg-surface-muted text-ink-muted">
              <Clock className="size-4" />
            </span>
          </div>
          <div className="mt-2">
            <span
              data-testid="kpi-renewals-count"
              className="text-2xl font-semibold tracking-tight text-ink tabular-nums"
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
            onChange={(e) => setIntervalFilter(e.target.value as 'ALL' | RecurringInterval)}
            options={[
              { value: 'ALL', label: 'All Intervals' },
              ...(Object.keys(INTERVAL_LABEL) as RecurringInterval[]).map((i) => ({
                value: i,
                label: INTERVAL_LABEL[i],
              })),
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
                  'rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer',
                  statusFilter === st
                    ? 'bg-surface text-ink shadow-2xs font-semibold'
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
          <div className="grid size-12 place-items-center rounded-2xl bg-surface-muted text-ink-muted">
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
        <div className="overflow-hidden rounded-2xl border border-border/40 bg-surface shadow-xs">
          <div className="overflow-x-auto">
            <table data-testid="subscriptions-table" className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border/30 bg-surface-muted/40 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
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

                  const expanded = expandedId === sub.id;

                  return (
                    <Fragment key={sub.id}>
                    <tr
                      data-testid={`subscription-row-${sub.id}`}
                      className="group transition-colors hover:bg-surface-muted/30"
                    >
                      {/* Vendor & Category */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            data-testid={`btn-expand-sub-${sub.id}`}
                            aria-expanded={expanded}
                            aria-label={expanded ? 'Hide bills' : 'Show bills'}
                            onClick={() => setExpandedId(expanded ? null : sub.id)}
                            className="rounded-lg p-1 text-ink-subtle hover:bg-surface-muted hover:text-ink cursor-pointer"
                          >
                            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                          </button>
                          <div className="grid size-9 place-items-center rounded-xl border border-border/30 bg-surface-muted/60 text-ink-muted group-hover:border-border-strong transition-colors">
                            <Icon className="size-4" />
                          </div>
                          <div>
                            <span
                              data-testid={`sub-vendor-${sub.id}`}
                              className="font-semibold text-ink transition-colors"
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
                              {!sub.supplierId && (
                                <Badge data-testid={`sub-badge-supplier-${sub.id}`} tone="warning" className="ml-2 text-[11px] py-0">
                                  Link a supplier
                                </Badge>
                              )}
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
                              className="font-mono font-semibold text-ink tabular-nums"
                            >
                              {formatFinanceCurrency(sub.amount, currencyOf(sub))}
                            </span>
                            <span className="text-[11px] text-ink-subtle font-medium">
                              / {INTERVAL_SUFFIX[sub.billingInterval]}
                            </span>
                          </div>
                          <p data-testid={`sub-interval-${sub.id}`} className="text-[11px] text-ink-subtle">
                            {INTERVAL_LABEL[sub.billingInterval]}
                          </p>
                          {sub.billingInterval !== 'MONTHLY' && (
                            <p className="font-mono text-[11px] text-ink-muted">
                              ~{formatFinanceCurrency(normalizedMonthly, currencyOf(sub))}/mo
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
                            className="text-ink-subtle"
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
                              className="text-[11px] py-0 font-semibold"
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
                          className="text-[11px] font-semibold"
                        >
                          {sub.status}
                        </Badge>
                        {sub.lastOccurrenceStatus === 'FAILED' && (
                          <Badge data-testid={`sub-badge-failed-${sub.id}`} tone="danger" className="ml-1 text-[11px] py-0">
                            Failed
                          </Badge>
                        )}
                        {hasEnded(sub) && (
                          <Badge data-testid={`sub-badge-ended-${sub.id}`} tone="neutral" className="ml-1 text-[11px] py-0">
                            Ended
                          </Badge>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {onToggleStatus && sub.status !== 'CANCELLED' && (
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
                              title={sub.status === 'ACTIVE' ? 'Pause subscription' : 'Resume subscription'}
                              className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-ink transition-colors cursor-pointer"
                            >
                              {sub.status === 'ACTIVE' ? (
                                <PauseCircle className="size-4 text-warning" />
                              ) : (
                                <PlayCircle className="size-4 text-success" />
                              )}
                            </button>
                          )}

                          {onEditSubscription && sub.status !== 'CANCELLED' && (
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

                          {onDeleteSubscription && sub.status !== 'CANCELLED' && (
                            <button
                              type="button"
                              data-testid={`btn-delete-sub-${sub.id}`}
                              onClick={() => onDeleteSubscription(sub)}
                              aria-label="Cancel subscription"
                              className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-danger transition-colors cursor-pointer"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr data-testid={`subscription-expanded-${sub.id}`} className="bg-surface-muted/20">
                        <td colSpan={6}>
                          <OccurrencesPanel id={sub.id} currency={currencyOf(sub)} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
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
