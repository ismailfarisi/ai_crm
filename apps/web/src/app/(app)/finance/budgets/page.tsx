import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { BudgetsView } from '@/components/finance/budgets/budgets-view';

export const metadata: Metadata = { title: 'Category Budgets' };

export default function BudgetsPage() {
  return (
    <PageGuard permission={PERMISSIONS.FINANCE_READ} title="You cannot view category budgets">
      <BudgetsView />
    </PageGuard>
  );
}
