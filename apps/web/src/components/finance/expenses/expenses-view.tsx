'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Receipt,
  Plus,
  Clock,
  CheckCircle2,
  DollarSign,
  LucideIcon,
  Filter,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { FinanceNav } from '../finance-nav';
import { ExpenseClaimsTable } from './expense-claims-table';
import { SubmitExpenseModal } from './submit-expense-modal';
import { useExpenses } from '@/hooks/use-expenses';
import { formatExpenseCurrency } from './receipt-preview-card';
import type { ExpenseClaimDto } from '@saas/shared';

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

export function ExpensesView() {
  const router = useRouter();
  const {
    claims,
    isLoading,
    createClaim,
    signalClaim,
    isCreating,
  } = useExpenses();

  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);

  // Computed summary metrics
  const totalClaimsCount = claims.length;
  const totalAmount = claims.reduce((acc, c) => acc + (c.amount || 0), 0);
  const pendingClaims = claims.filter((c) => c.status === 'SUBMITTED');
  const paidClaims = claims.filter((c) => c.status === 'PAID');

  const handleSelectClaim = (claim: ExpenseClaimDto) => {
    router.push(`/finance/expenses/${claim.id}`);
  };

  const handleApprove = async (claim: ExpenseClaimDto) => {
    await signalClaim(claim.id, { action: 'APPROVE' });
  };

  const handleReject = async (claim: ExpenseClaimDto, reason?: string) => {
    await signalClaim(claim.id, { action: 'REJECT', reason });
  };

  const handleReimburse = async (claim: ExpenseClaimDto) => {
    await signalClaim(claim.id, { action: 'REIMBURSE' });
  };

  return (
    <div data-testid="expenses-view" className="space-y-6">
      <PageHeader
        title="Expense Claims & Receipts"
        description="Review corporate expenditure claims, inspect scanned receipts, and approve reimbursements."
        actions={
          <Button
            type="button"
            variant="primary"
            size="sm"
            data-testid="submit-new-claim-btn"
            onClick={() => setIsSubmitModalOpen(true)}
            className="font-semibold shadow-xs"
          >
            <Plus className="size-3.5" />
            Submit Expense Claim
          </Button>
        }
      />

      <FinanceNav />

      {/* Summary KPI Stats */}
      <div className="flex flex-wrap items-center gap-x-12 gap-y-4 py-1">
        <StatItem
          label="Total Claims"
          value={totalClaimsCount}
          icon={Receipt}
          tone="brand"
          data-testid="stat-total-claims"
        />
        <StatItem
          label="Gross Submitted"
          value={formatExpenseCurrency(totalAmount)}
          icon={DollarSign}
          tone="info"
          data-testid="stat-gross-amount"
        />
        <StatItem
          label="Pending Review"
          value={pendingClaims.length}
          icon={Clock}
          tone="warning"
          data-testid="stat-pending-claims"
        />
        <StatItem
          label="Reimbursed"
          value={paidClaims.length}
          icon={CheckCircle2}
          tone="success"
          data-testid="stat-paid-claims"
        />
      </div>

      {/* Claims Table with Filters, Search & Actions */}
      <ExpenseClaimsTable
        claims={claims}
        isLoading={isLoading}
        onSelectClaim={handleSelectClaim}
        onApprove={handleApprove}
        onReject={handleReject}
        onReimburse={handleReimburse}
        onNewClaim={() => setIsSubmitModalOpen(true)}
      />

      {/* Submit Expense Modal */}
      <SubmitExpenseModal
        open={isSubmitModalOpen}
        onClose={() => setIsSubmitModalOpen(false)}
        onSubmit={async (payload) => {
          await createClaim(payload);
          setIsSubmitModalOpen(false);
        }}
        isLoading={isCreating}
      />
    </div>
  );
}
