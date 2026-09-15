import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { OrderDetail } from '@/components/orders/order-detail';

export const metadata: Metadata = { title: 'Sales order' };

/** `params` is async in this version of Next — see apps/web/AGENTS.md. */
export default async function SalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageGuard permission={PERMISSIONS.SALES_ORDER_READ} title="You can't view sales orders">
      <OrderDetail id={id} />
    </PageGuard>
  );
}
