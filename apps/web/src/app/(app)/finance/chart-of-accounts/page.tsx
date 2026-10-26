import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { ChartOfAccountsView } from '@/components/finance/books/chart-of-accounts-view';

export const metadata: Metadata = { title: 'Chart of Accounts' };

export default function ChartOfAccountsPage() {
  return (
    <PageGuard permission={PERMISSIONS.FINANCE_READ} title="You cannot view the chart of accounts">
      <ChartOfAccountsView />
    </PageGuard>
  );
}
