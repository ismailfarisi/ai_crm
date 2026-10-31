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
} from 'lucide-react';
import { PageHeader } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { FinanceNav } from '../finance-nav';
import { AccountBalanceGrid } from '../dashboard/account-balance-grid';
import { formatFinanceCurrency, OtherCurrencies, splitByBase, totalsByCurrency } from '../money';
import { useOrganization } from '@/hooks/use-organization';
import { CreateAccountModal } from './create-account-modal';
import { TransferFundsModal } from './transfer-funds-modal';
import {
  useFinanceAccounts,
  useCreateFinanceAccount,
  useUpdateFinanceAccount,
  useTransferFunds,
} from '@/hooks/use-finance';
import { PERMISSIONS, type FinanceAccountDto } from '@saas/shared';
import { useRouter } from 'next/navigation';
import { useCan } from '@/lib/session-context';

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
        <p className="text-xs font-semibold text-ink-muted">{label}</p>
        <p className="text-2xl font-semibold tabular-nums text-ink tracking-tight">{value}</p>
        {note}
      </div>
    </div>
  );
}

export function AccountsView() {
  const { data: accounts = [], isLoading } = useFinanceAccounts();
  const createAccountMutation = useCreateFinanceAccount();
  const updateAccountMutation = useUpdateFinanceAccount();
  const transferFundsMutation = useTransferFunds();
  const router = useRouter();
  const canReconcile = useCan({ permission: PERMISSIONS.BANK_RECONCILE });

  const [isNewAccountModalOpen, setIsNewAccountModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [selectedTransferFromId, setSelectedTransferFromId] = useState<string | undefined>(undefined);

  // Balances are only added within a currency: the total is the base-currency
  // accounts, and anything held in another currency is listed under it.
  const base = useOrganization().data?.baseCurrency;
  const cash = splitByBase(
    totalsByCurrency(accounts, (a) => a.balance, (a) => a.currency),
    base ?? '',
  );
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
        title="Accounts"
        description="Bank, petty cash and card accounts, each in its own currency."
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
              Transfer money
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
              New account
            </Button>
          </div>
        }
      />

      <FinanceNav />

      {/* Summary KPI Stats */}
      <div className="flex flex-wrap items-center gap-x-12 gap-y-4 py-1">
        <StatItem
          label={base ? `Cash in ${base}` : 'Cash'}
          value={base ? formatFinanceCurrency(cash.base, base) : '…'}
          icon={Wallet}
          note={base ? <OtherCurrencies others={cash.others} data-testid="stat-other-currencies" /> : null}
          data-testid="stat-total-liquidity"
        />
        <StatItem
          label="Bank Accounts"
          value={bankAccountsCount}
          icon={Landmark}
          data-testid="stat-bank-accounts-count"
        />
        <StatItem
          label="Cash & Gateways"
          value={cashOrClearingCount}
          icon={Building2}
          data-testid="stat-cash-clearing-count"
        />
        <StatItem
          label="Default Account"
          value={defaultAccount ? defaultAccount.name : 'None set'}
          icon={CheckCircle2}
          data-testid="stat-default-account"
        />
      </div>

      {/* Grid of Bank Accounts */}
      <AccountBalanceGrid
        accounts={accounts}
        isLoading={isLoading}
        onTransfer={handleOpenTransfer}
        onNewAccount={() => setIsNewAccountModalOpen(true)}
        onMakeDefault={(id) => updateAccountMutation.mutate({ id, isDefault: true })}
        onReconcile={canReconcile ? (id) => router.push(`/finance/accounts/${id}/reconcile`) : undefined}
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
