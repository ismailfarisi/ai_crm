import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { ExpensesView } from '@/components/finance/expenses/expenses-view';

export const metadata: Metadata = { title: 'Expense Claims & Receipts' };

export default function ExpensesPage() {
  return (
    <PageGuard permission={PERMISSIONS.FINANCE_READ} title="You cannot view expense claims">
      <ExpensesView />
    </PageGuard>
  );
}
