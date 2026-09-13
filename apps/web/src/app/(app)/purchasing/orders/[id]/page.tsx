import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { PurchaseOrderDetail } from '@/components/purchasing/purchase-order-detail';

export const metadata: Metadata = { title: 'Purchase order' };

/** `params` is async in this version of Next — see apps/web/AGENTS.md. */
export default async function PurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <PageGuard
      permission={PERMISSIONS.PURCHASE_ORDER_READ}
      title="You can't view purchase orders"
    >
      <PurchaseOrderDetail id={id} />
    </PageGuard>
  );
}
