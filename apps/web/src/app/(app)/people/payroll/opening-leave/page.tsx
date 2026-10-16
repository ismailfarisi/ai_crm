import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { OpeningLeaveView } from '@/components/people/opening-leave-view';

export const metadata: Metadata = { title: 'Opening leave balances' };

export default function OpeningLeavePage() {
  return (
    <PageGuard permission={PERMISSIONS.PAYROLL_MANAGE} title="You can't set up opening leave balances">
      <OpeningLeaveView />
    </PageGuard>
  );
}
