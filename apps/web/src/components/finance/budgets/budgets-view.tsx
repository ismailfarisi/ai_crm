'use client';

import React, { useState } from 'react';
import {
  DollarSign,
  Plus,
  Target,
  AlertTriangle,
  TrendingDown,
  Percent,
  CheckCircle2,
  LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { FinanceNav } from '../finance-nav';
import { BudgetGrid, formatBudgetCurrency } from './budget-meter-card';
import { CreateBudgetModal } from './create-budget-modal';
import { useCategoryBudgets, useCreateCategoryBudget } from '@/hooks/use-finance';
import { useOrganization } from '@/hooks/use-organization';

function StatItem({
  label,
  value,
  icon: Icon,
  'data-testid': testId,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  'data-testid'?: string;
}) {
  return (
    <div data-testid={testId} className="flex items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-muted text-ink-muted">
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">{label}</p>
        <p className="text-2xl font-semibold tabular-nums text-ink tracking-tight">{value}</p>
      </div>
    </div>
  );
}

export function BudgetsView() {
  const { data: budgets = [], isLoading } = useCategoryBudgets();
  const createBudgetMutation = useCreateCategoryBudget();
  // Budgets have no currency of their own; they are set in the base currency.
  const base = useOrganization().data?.baseCurrency ?? '';

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Computed summary metrics
  const totalAllocated = budgets.reduce((acc, b) => acc + (b.budgetAmount || 0), 0);
  const totalSpent = budgets.reduce((acc, b) => acc + (b.spentAmount || 0), 0);
  const remainingBudget = Math.max(0, totalAllocated - totalSpent);
  const overallUtilization =
    totalAllocated > 0 ? ((totalSpent / totalAllocated) * 100).toFixed(1) : '0';

  return (
    <div data-testid="budgets-view" className="space-y-6">
      <PageHeader
        title="Department & Category Budgets"
        description="Monitor departmental spending limits, analyze category utilization, and prevent cost overruns."
        actions={
          <Button
            type="button"
            variant="primary"
            size="sm"
            data-testid="create-budget-btn"
            onClick={() => setIsCreateModalOpen(true)}
            className="font-semibold shadow-xs"
          >
            <Plus className="size-3.5" />
            New Budget Cap
          </Button>
        }
      />

      <FinanceNav />

      {/* Summary KPI Stats */}
      <div className="flex flex-wrap items-center gap-x-12 gap-y-4 py-1">
        <StatItem
          label="Total Allocated"
          value={formatBudgetCurrency(totalAllocated, base)}
          icon={Target}
          data-testid="stat-total-allocated"
        />
        <StatItem
          label="Total Spent"
          value={formatBudgetCurrency(totalSpent, base)}
          icon={TrendingDown}
          data-testid="stat-total-spent"
        />
        <StatItem
          label="Remaining Buffer"
          value={formatBudgetCurrency(remainingBudget, base)}
          icon={CheckCircle2}
          data-testid="stat-remaining-buffer"
        />
        <StatItem
          label="Avg Utilization"
          value={`${overallUtilization}%`}
          icon={Percent}
          data-testid="stat-avg-utilization"
        />
      </div>

      {/* Grid of Budget Cards */}
      <BudgetGrid
        budgets={budgets}
        currency={base}
        isLoading={isLoading}
        onNewBudget={() => setIsCreateModalOpen(true)}
      />

      {/* Create Budget Modal */}
      <CreateBudgetModal
        open={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={async (payload) => {
          await createBudgetMutation.mutateAsync(payload);
          setIsCreateModalOpen(false);
        }}
        isLoading={createBudgetMutation.isPending}
      />
    </div>
  );
}
