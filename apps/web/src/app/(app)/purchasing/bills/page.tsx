import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { BillsView } from '@/components/payables/bills-view';

export const metadata: Metadata = { title: 'Supplier bills' };

export default function BillsPage() {
  return (
    <PageGuard permission={PERMISSIONS.BILL_READ} title="You can't view supplier bills">
      <BillsView />
    </PageGuard>
  );
}
