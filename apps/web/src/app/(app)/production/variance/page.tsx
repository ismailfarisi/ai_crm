import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { VarianceReport } from '@/components/production/variance-report';

export const metadata: Metadata = { title: 'Estimate vs actual' };

export default function VariancePage() {
  return (
    <PageGuard
      permission={[PERMISSIONS.WORK_ORDER_READ, PERMISSIONS.QUOTE_VIEW_COST]}
      title="You can't view production costs"
    >
      <VarianceReport />
    </PageGuard>
  );
}
