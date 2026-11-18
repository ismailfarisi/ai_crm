import type { Metadata } from 'next';
import { use } from 'react';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { InvoiceDetailPage } from '@/components/invoices/invoice-detail-page';

export const metadata: Metadata = { title: 'Invoice' };

export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);

  return (
    <PageGuard permission={PERMISSIONS.INVOICE_READ} title="You can't view this invoice">
      <InvoiceDetailPage invoiceId={resolvedParams.id} />
    </PageGuard>
  );
}
