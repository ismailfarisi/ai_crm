import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { WorkOrderFloor } from '@/components/production/work-order-floor';

export const metadata: Metadata = { title: 'Work order' };

/** `params` is async in this version of Next — see apps/web/AGENTS.md. */
export default async function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageGuard permission={PERMISSIONS.WORK_ORDER_READ} title="You can't view production">
      <WorkOrderFloor id={id} />
    </PageGuard>
  );
}
