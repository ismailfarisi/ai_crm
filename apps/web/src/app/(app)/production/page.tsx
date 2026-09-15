import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { ProductionBoard } from '@/components/production/production-board';

export const metadata: Metadata = { title: 'Production' };

export default function ProductionPage() {
  return (
    <PageGuard permission={PERMISSIONS.WORK_ORDER_READ} title="You can't view production">
      <ProductionBoard />
    </PageGuard>
  );
}
