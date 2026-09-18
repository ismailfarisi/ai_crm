import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { CustomerDetailView } from '@/components/customers/customer-detail-view';

export const metadata: Metadata = { title: 'Customer' };

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <PageGuard permission={PERMISSIONS.CUSTOMER_READ} title="You can't view this customer">
      <CustomerDetailView params={params} />
    </PageGuard>
  );
}
