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
import { formatFinanceCurrency, OtherCurrencies, splitByBase, totalsByCurrency } from '../money';
import { useOrganization } from '@/hooks/use-organization';
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

function StatItem({
  label,
  value,
  icon: Icon,
  note,
  'data-testid': testId,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  note?: React.ReactNode;
  'data-testid'?: string;
}) {
  return (
    <div data-testid={testId} className="flex items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-muted text-ink-muted">
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">{label}</p>
        <p className="text-2xl font-semibold tabular-nums text-ink tracking-tight">{value}</p>
        {note}
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

  // A schedule is billed in its supplier's currency, or the base currency
  // without one. Monthly costs are only added within a currency.
  const base = useOrganization().data?.baseCurrency ?? '';
  const monthly = splitByBase(
    totalsByCurrency(
      activeSubs,
      (s) => monthlyEquivalent(s.amount || 0, s.billingInterval),
      (s) => s.currency || base,
    ),
    base,
  );

  return (
    <div data-testid="subscriptions-view" className="space-y-6">
      <PageHeader
        title="Subscriptions"
        description="Rent, licences, utilities and other bills that come round on a schedule."
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
          label="Monthly cost"
          value={formatFinanceCurrency(monthly.base, base)}
          icon={DollarSign}
          note={<OtherCurrencies others={monthly.others} />}
          data-testid="stat-monthly-run-rate"
        />
        <StatItem
          label="Yearly cost"
          value={formatFinanceCurrency(monthly.base * 12, base)}
          icon={TrendingUp}
          note={<OtherCurrencies others={monthly.others.map((o) => ({ ...o, amount: o.amount * 12 }))} />}
          data-testid="stat-annualized-spend"
        />
        <StatItem
          label="Active Subscriptions"
          value={activeSubs.length}
          icon={Layers}
          data-testid="stat-active-subs-count"
        />
        <StatItem
          label="Paused / Inactive"
          value={pausedOrCancelled.length}
          icon={PauseCircle}
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
