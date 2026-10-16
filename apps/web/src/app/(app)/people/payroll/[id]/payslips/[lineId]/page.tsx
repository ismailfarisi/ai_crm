import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { PayslipView } from '@/components/people/payslip-view';

export const metadata: Metadata = { title: 'Payslip' };

export default async function PayslipPage({ params }: { params: Promise<{ id: string; lineId: string }> }) {
  const { id, lineId } = await params;
  return (
    <PageGuard permission={PERMISSIONS.PAYROLL_READ} title="You can't view payroll">
      <PayslipView runId={id} lineId={lineId} />
    </PageGuard>
  );
}
