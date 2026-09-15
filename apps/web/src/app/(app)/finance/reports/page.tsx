import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { ReportsView } from '@/components/finance/reports/reports-view';

export const metadata: Metadata = { title: 'Financial reports' };

export default function Page() {
  return (
    <PageGuard permission={PERMISSIONS.FINANCE_READ} title="You cannot view finance">
      <ReportsView />
    </PageGuard>
  );
}
