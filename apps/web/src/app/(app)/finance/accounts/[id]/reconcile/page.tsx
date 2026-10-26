import type { Metadata } from 'next';
import { use } from 'react';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { ReconciliationView } from '@/components/finance/books/reconciliation-view';

export const metadata: Metadata = { title: 'Bank Reconciliation' };

export default function ReconcilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  return (
    <PageGuard permission={PERMISSIONS.FINANCE_READ} title="You cannot view bank reconciliation">
      <ReconciliationView financeAccountId={id} />
    </PageGuard>
  );
}
