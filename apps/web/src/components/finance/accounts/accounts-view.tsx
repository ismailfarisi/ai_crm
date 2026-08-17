'use client';

import React, { useState } from 'react';
import {
  Landmark,
  Plus,
  ArrowLeftRight,
  Wallet,
  Building2,
  CheckCircle2,
  LucideIcon,
  ShieldCheck,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { FinanceNav } from '../finance-nav';
import { AccountBalanceGrid } from '../dashboard/account-balance-grid';
import { formatFinanceCurrency } from '../dashboard/treasury-stat-cards';
import { CreateAccountModal } from './create-account-modal';
import { TransferFundsModal } from './transfer-funds-modal';
import {
  useFinanceAccounts,
  useCreateFinanceAccount,
  useTransferFunds,
} from '@/hooks/use-finance';
import type { FinanceAccountDto } from '@saas/shared';

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

export function AccountsView() {
  const { data: accounts = [], isLoading } = useFinanceAccounts();
  const createAccountMutation = useCreateFinanceAccount();
  const transferFundsMutation = useTransferFunds();

  const [isNewAccountModalOpen, setIsNewAccountModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [selectedTransferFromId, setSelectedTransferFromId] = useState<string | undefined>(undefined);

  // Computed summary metrics
  const totalBalance = accounts.reduce((acc, a) => acc + (a.balance || 0), 0);
  const bankAccountsCount = accounts.filter((a) => a.accountType === 'BANK').length;
  const cashOrClearingCount = accounts.filter(
    (a) => a.accountType === 'CASH' || a.accountType === 'CLEARING',
  ).length;
  const defaultAccount = accounts.find((a) => a.isDefault);

  const handleOpenTransfer = (fromAccountId?: string) => {
    setSelectedTransferFromId(fromAccountId);
    setIsTransferModalOpen(true);
  };

  return (
    <div data-testid="accounts-view" className="space-y-6">
      <PageHeader
        title="Treasury & Bank Accounts"
        description="Monitor liquidity balances across connected corporate bank accounts, cash floats, and gateway processors."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="accounts-transfer-funds-btn"
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
              data-testid="accounts-new-account-btn"
              onClick={() => setIsNewAccountModalOpen(true)}
              className="font-semibold shadow-xs"
            >
              <Plus className="size-3.5" />
              New Account
            </Button>
          </div>
        }
      />

      <FinanceNav />

      {/* Summary KPI Stats */}
      <div className="flex flex-wrap items-center gap-x-12 gap-y-4 py-1">
        <StatItem
          label="Total Liquidity"
          value={formatFinanceCurrency(totalBalance)}
          icon={Wallet}
          tone="brand"
          data-testid="stat-total-liquidity"
        />
        <StatItem
          label="Bank Accounts"
          value={bankAccountsCount}
          icon={Landmark}
          tone="info"
          data-testid="stat-bank-accounts-count"
        />
        <StatItem
          label="Cash & Gateways"
          value={cashOrClearingCount}
          icon={Building2}
          tone="warning"
          data-testid="stat-cash-clearing-count"
        />
        <StatItem
          label="Default Account"
          value={defaultAccount ? defaultAccount.name : 'None set'}
          icon={CheckCircle2}
          tone="success"
          data-testid="stat-default-account"
        />
      </div>

      {/* Grid of Bank Accounts */}
      <AccountBalanceGrid
        accounts={accounts}
        isLoading={isLoading}
        onTransfer={handleOpenTransfer}
        onNewAccount={() => setIsNewAccountModalOpen(true)}
      />

      {/* Modals */}
      <CreateAccountModal
        open={isNewAccountModalOpen}
        onClose={() => setIsNewAccountModalOpen(false)}
        onSubmit={async (payload) => {
          await createAccountMutation.mutateAsync(payload);
          setIsNewAccountModalOpen(false);
        }}
        isLoading={createAccountMutation.isPending}
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
    </div>
  );
}
