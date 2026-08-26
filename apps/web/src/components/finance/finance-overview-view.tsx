'use client';

import React, { useState } from 'react';
import {
  Landmark,
  Receipt,
  ArrowLeftRight,
  Plus,
  DollarSign,
  TrendingUp,
  ShieldCheck,
  Building2,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { FinanceNav } from './finance-nav';
import { TreasuryStatCards } from './dashboard/treasury-stat-cards';
import { CashflowTrendChart } from './dashboard/cashflow-trend-chart';
import { AccountBalanceGrid } from './dashboard/account-balance-grid';
import {
  useFinanceOverview,
  useFinanceAccounts,
  useCreateFinanceAccount,
  useTransferFunds,
  useCreateCategoryBudget,
} from '@/hooks/use-finance';
import { useExpenses } from '@/hooks/use-expenses';
import { CreateAccountModal } from './accounts/create-account-modal';
import { TransferFundsModal } from './accounts/transfer-funds-modal';
import { SubmitExpenseModal } from './expenses/submit-expense-modal';
import { CreateBudgetModal } from './budgets/create-budget-modal';

export function FinanceOverviewView() {
  const { data: overview, isLoading: isOverviewLoading } = useFinanceOverview();
  const { data: accounts = [], isLoading: isAccountsLoading } = useFinanceAccounts();
  const { createClaim } = useExpenses();

  const createAccountMutation = useCreateFinanceAccount();
  const transferFundsMutation = useTransferFunds();
  const createBudgetMutation = useCreateCategoryBudget();

  // Modal states
  const [isSubmitExpenseOpen, setIsSubmitExpenseOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isNewAccountModalOpen, setIsNewAccountModalOpen] = useState(false);
  const [isNewBudgetModalOpen, setIsNewBudgetModalOpen] = useState(false);
  const [selectedTransferFromId, setSelectedTransferFromId] = useState<string | undefined>(undefined);

  const handleOpenTransfer = (fromAccountId?: string) => {
    setSelectedTransferFromId(fromAccountId);
    setIsTransferModalOpen(true);
  };

  return (
    <div data-testid="finance-overview-view" className="space-y-6">
      <PageHeader
        title="Finance & Treasury"
        description="Monitor liquidity, burn velocity, runway projections, and inter-account treasury movements."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="overview-quick-transfer-btn"
              onClick={() => handleOpenTransfer()}
              className="font-semibold shadow-2xs"
            >
              <ArrowLeftRight className="size-3.5" />
              Transfer Funds
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              data-testid="overview-quick-expense-btn"
              onClick={() => setIsSubmitExpenseOpen(true)}
              className="font-semibold shadow-xs"
            >
              <Receipt className="size-3.5" />
              Submit Expense
            </Button>
          </div>
        }
      />

      <FinanceNav />

      {/* Primary KPI Stats */}
      <TreasuryStatCards
        overview={overview}
        isLoading={isOverviewLoading}
      />

      {/* Charts & Analytical Breakdown */}
      <div className="grid grid-cols-1 gap-6">
        <CashflowTrendChart
          currency={overview?.currency || 'USD'}
          isLoading={isOverviewLoading}
        />
      </div>

      {/* Bank & Cash Accounts Grid */}
      <AccountBalanceGrid
        accounts={accounts}
        isLoading={isAccountsLoading}
        onTransfer={handleOpenTransfer}
        onNewAccount={() => setIsNewAccountModalOpen(true)}
      />

      {/* Modals */}
      <SubmitExpenseModal
        open={isSubmitExpenseOpen}
        onClose={() => setIsSubmitExpenseOpen(false)}
        onSubmit={async (payload) => {
          await createClaim(payload);
          setIsSubmitExpenseOpen(false);
        }}
      />

      <TransferFundsModal
        open={isTransferModalOpen}
        onClose={() => {
          setIsTransferModalOpen(false);
          setSelectedTransferFromId(undefined);
        }}
        accounts={accounts}
        defaultFromAccountId={selectedTransferFromId}
        onSubmit={async (payload) => {
          await transferFundsMutation.mutateAsync(payload);
          setIsTransferModalOpen(false);
          setSelectedTransferFromId(undefined);
        }}
        isLoading={transferFundsMutation.isPending}
      />

      <CreateAccountModal
        open={isNewAccountModalOpen}
        onClose={() => setIsNewAccountModalOpen(false)}
        onSubmit={async (payload) => {
          await createAccountMutation.mutateAsync(payload);
          setIsNewAccountModalOpen(false);
        }}
        isLoading={createAccountMutation.isPending}
      />

      <CreateBudgetModal
        open={isNewBudgetModalOpen}
        onClose={() => setIsNewBudgetModalOpen(false)}
        onSubmit={async (payload) => {
          await createBudgetMutation.mutateAsync(payload);
          setIsNewBudgetModalOpen(false);
        }}
        isLoading={createBudgetMutation.isPending}
      />
    </div>
  );
}
