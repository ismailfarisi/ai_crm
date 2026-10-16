import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { PayrollRunDetail } from '@/components/people/payroll-run-detail';

export const metadata: Metadata = { title: 'Payroll run' };

/** `params` is async in this version of Next — see apps/web/AGENTS.md. */
export default async function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageGuard permission={PERMISSIONS.PAYROLL_READ} title="You can't view payroll">
      <PayrollRunDetail id={id} />
    </PageGuard>
  );
}
