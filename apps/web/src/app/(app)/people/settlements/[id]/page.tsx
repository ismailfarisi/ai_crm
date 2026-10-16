import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { SettlementDetail } from '@/components/people/settlement-detail';

export const metadata: Metadata = { title: 'Settlement' };

/** `params` is async in this version of Next — see apps/web/AGENTS.md. */
export default async function SettlementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageGuard permission={PERMISSIONS.PAYROLL_READ} title="You can't view settlements">
      <SettlementDetail id={id} />
    </PageGuard>
  );
}
