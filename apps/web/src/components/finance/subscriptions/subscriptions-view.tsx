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
import { SubscriptionFormModal } from './subscription-form-modal';
import { Dialog } from '@/components/ui/dialog';
import { formatFinanceCurrency } from '../dashboard/treasury-stat-cards';
import {
  useRecurringExpenses,
  useFinanceAccounts,
  useCreateRecurringExpense,
  useUpdateRecurringExpense,
  usePauseRecurringExpense,
  useResumeRecurringExpense,
  useCancelRecurringExpense,
  useRecurringOccurrences,
} from '@/hooks/use-finance';
import {
  monthlyEquivalent,
  type CreateRecurringExpensePayload,
  type RecurringExpenseDto,
  type UpdateRecurringExpensePayload,
} from '@saas/shared';

const DIFF_KEYS = [
  'supplierId',
  'vendorName',
  'category',
  'amount',
  'billingInterval',
  'startDate',
  'endDate',
  'taxCodeId',
  'autoApprove',
  'spreadOverPeriod',
] as const;

/** Only what changed, so an edit never asks the server to touch what the user left alone. */
export function diffRecurringExpense(
  existing: RecurringExpenseDto,
  next: CreateRecurringExpensePayload,
): UpdateRecurringExpensePayload {
  const changed: Record<string, unknown> = {};
  for (const key of DIFF_KEYS) {
    if (next[key] !== existing[key]) changed[key] = next[key];
  }
  return changed as UpdateRecurringExpensePayload;
}

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
  const updateSubMutation = useUpdateRecurringExpense();
  const pauseSubMutation = usePauseRecurringExpense();
  const resumeSubMutation = useResumeRecurringExpense();
  const cancelSubMutation = useCancelRecurringExpense();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringExpenseDto | null>(null);
  const [cancelling, setCancelling] = useState<RecurringExpenseDto | null>(null);

  // Start date and interval lock once a bill exists, whether or not it is still listed.
  const { data: editingOccurrences = [] } = useRecurringOccurrences(editing?.id ?? null);
  const hasOccurrences =
    editingOccurrences.length > 0 || Boolean(editing && editing.lastOccurrenceStatus !== null);

  // Compute metrics: monthly normalized sum
  const activeSubs = subscriptions.filter((s) => s.status === 'ACTIVE');
  const pausedOrCancelled = subscriptions.filter((s) => s.status !== 'ACTIVE');

  const monthlyNormalized = activeSubs.reduce(
    (acc, s) => acc + monthlyEquivalent(s.amount || 0, s.billingInterval),
    0,
  );

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
        onEditSubscription={(sub) => setEditing(sub)}
        onToggleStatus={async (sub, next) => {
          if (next === 'PAUSED') await pauseSubMutation.mutateAsync(sub.id).catch(() => undefined);
          else if (next === 'ACTIVE') await resumeSubMutation.mutateAsync(sub.id).catch(() => undefined);
        }}
        onDeleteSubscription={(sub) => setCancelling(sub)}
      />

      {/* Create / edit */}
      <SubscriptionFormModal
        open={isCreateModalOpen || editing !== null}
        onClose={() => {
          setIsCreateModalOpen(false);
          setEditing(null);
        }}
        existing={editing}
        hasOccurrences={hasOccurrences}
        onSubmit={async (payload) => {
          if (editing) {
            const changes = diffRecurringExpense(editing, payload);
            if (Object.keys(changes).length === 0) return;
            await updateSubMutation.mutateAsync({ id: editing.id, input: changes });
          } else {
            await createSubMutation.mutateAsync(payload);
          }
        }}
        isLoading={createSubMutation.isPending || updateSubMutation.isPending}
      />

      <Dialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title="Cancel this recurring expense?"
        description={
          cancelling
            ? `No more bills will be created for "${cancelling.vendorName}". Bills already created are not affected.`
            : undefined
        }
        size="sm"
      >
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" data-testid="btn-keep-subscription" onClick={() => setCancelling(null)}>
            Keep it
          </Button>
          <Button
            type="button"
            variant="danger"
            data-testid="btn-confirm-cancel-subscription"
            loading={cancelSubMutation.isPending}
            onClick={async () => {
              if (!cancelling) return;
              await cancelSubMutation.mutateAsync(cancelling.id).catch(() => undefined);
              setCancelling(null);
            }}
          >
            Cancel recurring expense
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
