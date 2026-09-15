import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { OrdersView } from '@/components/orders/orders-view';

export const metadata: Metadata = { title: 'Sales orders' };

export default function SalesOrdersPage() {
  return (
    <PageGuard permission={PERMISSIONS.SALES_ORDER_READ} title="You can't view sales orders">
      <OrdersView />
    </PageGuard>
  );
}
