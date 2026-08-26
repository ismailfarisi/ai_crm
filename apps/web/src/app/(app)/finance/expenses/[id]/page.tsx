import type { Metadata } from 'next';
import { use } from 'react';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { ExpenseDetailView } from '@/components/finance/expenses/expense-detail-view';

export const metadata: Metadata = { title: 'Expense Claim Details' };

export default function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);

  return (
    <PageGuard permission={PERMISSIONS.FINANCE_READ} title="You cannot view expense claims">
      <ExpenseDetailView id={resolvedParams.id} />
    </PageGuard>
  );
}
