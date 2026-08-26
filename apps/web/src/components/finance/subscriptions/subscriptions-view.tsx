'use client';

import React, { useState } from 'react';
import {
  Layers,
  Plus,
  TrendingUp,
  CreditCard,
  Building2,
  Calendar,
  DollarSign,
  LucideIcon,
  PauseCircle,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { FinanceNav } from '../finance-nav';
import { SubscriptionsTable } from './subscriptions-table';
import { CreateSubscriptionModal } from './create-subscription-modal';
import { formatFinanceCurrency } from '../dashboard/treasury-stat-cards';
import {
  useRecurringExpenses,
  useFinanceAccounts,
  useCreateRecurringExpense,
} from '@/hooks/use-finance';
import type { RecurringExpenseDto } from '@saas/shared';

const STAT_TONES = {
  brand: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  info: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
} as const;

function StatItem({
  label,
  value,
  icon: Icon,
  tone = 'brand',
  'data-testid': testId,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: keyof typeof STAT_TONES;
  'data-testid'?: string;
}) {
  return (
    <div data-testid={testId} className="flex items-center gap-3">
      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${STAT_TONES[tone]}`}>
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">{label}</p>
        <p className="text-2xl font-semibold tabular-nums text-ink tracking-tight">{value}</p>
      </div>
    </div>
  );
}

export function SubscriptionsView() {
  const { data: subscriptions = [], isLoading: isSubsLoading } = useRecurringExpenses();
  const { data: accounts = [], isLoading: isAccountsLoading } = useFinanceAccounts();
  const createSubMutation = useCreateRecurringExpense();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Compute metrics: monthly normalized sum
  const activeSubs = subscriptions.filter((s) => s.status === 'ACTIVE');
  const pausedOrCancelled = subscriptions.filter((s) => s.status !== 'ACTIVE');

  const monthlyNormalized = activeSubs.reduce((acc, s) => {
    const amt = s.amount || 0;
    if (s.billingInterval === 'ANNUAL') return acc + amt / 12;
    return acc + amt;
  }, 0);

  const annualizedCost = monthlyNormalized * 12;

  return (
    <div data-testid="subscriptions-view" className="space-y-6">
      <PageHeader
        title="Subscriptions & SaaS Tools"
        description="Audit recurring cloud tools, prevent seat sprawl, and track renewal schedules across departments."
        actions={
          <Button
            type="button"
            variant="primary"
            size="sm"
            data-testid="add-subscription-btn"
            onClick={() => setIsCreateModalOpen(true)}
            className="font-semibold shadow-xs"
          >
            <Plus className="size-3.5" />
            Add Subscription
          </Button>
        }
      />

      <FinanceNav />

      {/* Summary KPI Stats */}
      <div className="flex flex-wrap items-center gap-x-12 gap-y-4 py-1">
        <StatItem
          label="Monthly SaaS Run Rate"
          value={formatFinanceCurrency(monthlyNormalized)}
          icon={DollarSign}
          tone="brand"
          data-testid="stat-monthly-run-rate"
        />
        <StatItem
          label="Annualized Spend"
          value={formatFinanceCurrency(annualizedCost)}
          icon={TrendingUp}
          tone="info"
          data-testid="stat-annualized-spend"
        />
        <StatItem
          label="Active Subscriptions"
          value={activeSubs.length}
          icon={Layers}
          tone="success"
          data-testid="stat-active-subs-count"
        />
        <StatItem
          label="Paused / Inactive"
          value={pausedOrCancelled.length}
          icon={PauseCircle}
          tone="warning"
          data-testid="stat-paused-subs-count"
        />
      </div>

      {/* Subscriptions Table with Filter & Category Badges */}
      <SubscriptionsTable
        subscriptions={subscriptions}
        accounts={accounts}
        isLoading={isSubsLoading || isAccountsLoading}
        onNewSubscription={() => setIsCreateModalOpen(true)}
      />

      {/* Add Subscription Modal */}
      <CreateSubscriptionModal
        open={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        accounts={accounts}
        onSubmit={async (payload) => {
          await createSubMutation.mutateAsync(payload);
          setIsCreateModalOpen(false);
        }}
        isLoading={createSubMutation.isPending}
      />
    </div>
  );
}
