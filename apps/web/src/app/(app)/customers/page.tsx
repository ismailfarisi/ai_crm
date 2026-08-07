import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { CustomersView } from '@/components/customers/customers-view';

export const metadata: Metadata = { title: 'Customers' };

export default function CustomersPage() {
  return (
    <PageGuard permission={PERMISSIONS.CUSTOMER_READ} title="You can't view customers">
      <CustomersView />
    </PageGuard>
  );
}
