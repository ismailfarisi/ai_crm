import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { InvoicesView } from '@/components/invoices/invoices-view';

export const metadata: Metadata = { title: 'Invoices' };

export default function InvoicesPage() {
  return (
    <PageGuard permission={PERMISSIONS.INVOICE_READ} title="You can't view invoices">
      <InvoicesView />
    </PageGuard>
  );
}
