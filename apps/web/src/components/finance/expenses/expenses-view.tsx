'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { PERMISSIONS } from '@saas/shared';
import type { ExpenseClaimDto } from '@saas/shared';
import { PageHeader } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Can } from '@/components/auth/can';
import { FinanceNav } from '../finance-nav';
import { ExpenseClaimsTable } from './expense-claims-table';
import { ExpenseSummary } from './expense-summary';
import { SubmitExpenseModal } from './submit-expense-modal';
import { reimbursementAccount } from './expense-money';
import { useExpenses } from '@/hooks/use-expenses';
import { useFinanceAccounts } from '@/hooks/use-finance';
import { useOrganization } from '@/hooks/use-organization';

export function ExpensesView() {
  const router = useRouter();
  const { claims, isLoading, createClaim, signalClaim, isCreating } = useExpenses();
  const baseCurrency = useOrganization().data?.baseCurrency;
  const payFrom = reimbursementAccount(useFinanceAccounts().data);

  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);

  const handleSelectClaim = (claim: ExpenseClaimDto) => {
    router.push(`/finance/expenses/${claim.id}`);
  };

  return (
    <div data-testid="expenses-view" className="space-y-6">
      <PageHeader
        title="Expense Claims & Receipts"
        description="Review claims, check the receipts, and approve and pay them back."
        actions={
          <Can permission={PERMISSIONS.EXPENSE_SUBMIT}>
            <Button
              type="button"
              variant="primary"
              data-testid="submit-new-claim-btn"
              onClick={() => setIsSubmitModalOpen(true)}
            >
              <Plus className="size-4" />
              Submit expense claim
            </Button>
          </Can>
        }
      />

      <FinanceNav />

      <ExpenseSummary claims={claims} baseCurrency={baseCurrency} />

      <ExpenseClaimsTable
        claims={claims}
        isLoading={isLoading}
        onSelectClaim={handleSelectClaim}
        onApprove={(claim) => signalClaim(claim.id, { action: 'APPROVE' })}
        onReject={(claim, reason) => signalClaim(claim.id, { action: 'REJECT', reason })}
        // The account named in the confirmation is the one paid from.
        onReimburse={(claim) =>
          signalClaim(claim.id, { action: 'REIMBURSE', accountId: payFrom?.id })
        }
        reimbursementAccountName={payFrom?.name}
        onNewClaim={() => setIsSubmitModalOpen(true)}
      />

      <SubmitExpenseModal
        open={isSubmitModalOpen}
        onClose={() => setIsSubmitModalOpen(false)}
        onSubmit={async (payload, receipt) => {
          await createClaim(payload, receipt);
          setIsSubmitModalOpen(false);
        }}
        isLoading={isCreating}
      />
    </div>
  );
}
