import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { PayrollRunsView } from '@/components/people/payroll-runs-view';

export const metadata: Metadata = { title: 'Payroll' };

export default function PayrollPage() {
  return (
    <PageGuard permission={PERMISSIONS.PAYROLL_READ} title="You can't view payroll">
      <PayrollRunsView />
    </PageGuard>
  );
}
