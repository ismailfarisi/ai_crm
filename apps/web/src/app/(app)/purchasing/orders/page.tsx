import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { PurchaseOrdersView } from '@/components/purchasing/purchase-orders-view';

export const metadata: Metadata = { title: 'Purchase orders' };

export default function PurchaseOrdersPage() {
  return (
    <PageGuard
      permission={PERMISSIONS.PURCHASE_ORDER_READ}
      title="You can't view purchase orders"
    >
      <PurchaseOrdersView />
    </PageGuard>
  );
}
