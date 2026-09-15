import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { BillDetail } from '@/components/payables/bill-detail';

export const metadata: Metadata = { title: 'Supplier bill' };

/** `params` is async in this version of Next — see apps/web/AGENTS.md. */
export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageGuard permission={PERMISSIONS.BILL_READ} title="You can't view supplier bills">
      <BillDetail id={id} />
    </PageGuard>
  );
}
