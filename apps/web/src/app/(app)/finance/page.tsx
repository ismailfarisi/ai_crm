import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { FinanceOverviewView } from '@/components/finance/finance-overview-view';

export const metadata: Metadata = { title: 'Finance & Treasury' };

export default function FinancePage() {
  return (
    <PageGuard permission={PERMISSIONS.FINANCE_READ} title="You cannot view finance overview">
      <FinanceOverviewView />
    </PageGuard>
  );
}
