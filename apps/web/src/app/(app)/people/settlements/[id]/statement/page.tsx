import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { SettlementStatementView } from '@/components/people/settlement-statement';

export const metadata: Metadata = { title: 'Settlement statement' };

export default async function SettlementStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageGuard permission={PERMISSIONS.PAYROLL_READ} title="You can't view settlements">
      <SettlementStatementView id={id} />
    </PageGuard>
  );
}
