'use client';

import React, { useState } from 'react';
import { Receipt, ArrowLeftRight } from 'lucide-react';
import { PERMISSIONS } from '@saas/shared';
import { PageHeader } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { useCan } from '@/lib/session-context';
import { useOrganization } from '@/hooks/use-organization';
import { FinanceNav } from './finance-nav';
import { CashHeadline, PayablesHeadline, ReceivablesHeadline, VatHeadline } from './dashboard/finance-headlines';
import { CashByAccount } from './dashboard/cash-by-account';
import { CashForecastTable } from './dashboard/cash-forecast-table';
import { useCashForecast, useFinanceAccounts, useTransferFunds } from '@/hooks/use-finance';
import { useExpenses } from '@/hooks/use-expenses';
import { TransferFundsModal } from './accounts/transfer-funds-modal';
import { SubmitExpenseModal } from './expenses/submit-expense-modal';

/**
 * The owner's four questions, each with its figure and the page that explains
 * it: how much cash there is, what customers owe, what VAT is due and which
 * supplier bills are due. Below them, cash by account and the months ahead.
 */
export function FinanceOverviewView() {
  const base = useOrganization().data?.baseCurrency;
  const { data: accounts = [], isLoading: isAccountsLoading } = useFinanceAccounts();
  const { data: forecast, isLoading: isForecastLoading } = useCashForecast(6);
  const { createClaim } = useExpenses();
  const transferFundsMutation = useTransferFunds();
  const canSeeBills = useCan({ permission: PERMISSIONS.BILL_READ });
  const canSeeTax = useCan({ permission: PERMISSIONS.TAX_READ });

  const [isSubmitExpenseOpen, setIsSubmitExpenseOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);

  return (
    <div data-testid="finance-overview-view" className="space-y-6">
      <PageHeader
        title="Finance"
        description={`Cash, what customers owe, VAT and supplier bills${base ? `, in ${base}` : ''}.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              data-testid="overview-quick-transfer-btn"
              onClick={() => setIsTransferModalOpen(true)}
            >
              <ArrowLeftRight className="size-4" />
              Transfer money
            </Button>
            <Button
              type="button"
              variant="primary"
              data-testid="overview-quick-expense-btn"
              onClick={() => setIsSubmitExpenseOpen(true)}
            >
              <Receipt className="size-4" />
              Submit expense
            </Button>
          </div>
        }
      />

      <FinanceNav />

      <div data-testid="finance-headlines" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CashHeadline accounts={accounts} base={base} isLoading={isAccountsLoading} />
        <ReceivablesHeadline />
        {canSeeTax && <VatHeadline base={base} />}
        {canSeeBills && <PayablesHeadline base={base} />}
      </div>

      <CashByAccount accounts={accounts} base={base} isLoading={isAccountsLoading} />

      <CashForecastTable forecast={forecast} isLoading={isForecastLoading} />

      <SubmitExpenseModal
        open={isSubmitExpenseOpen}
        onClose={() => setIsSubmitExpenseOpen(false)}
        onSubmit={async (payload, receipt) => {
          await createClaim(payload, receipt);
          setIsSubmitExpenseOpen(false);
        }}
      />

      <TransferFundsModal
        open={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        accounts={accounts}
        onSubmit={async (payload) => {
          await transferFundsMutation.mutateAsync(payload);
          setIsTransferModalOpen(false);
        }}
        isLoading={transferFundsMutation.isPending}
      />
    </div>
  );
}
