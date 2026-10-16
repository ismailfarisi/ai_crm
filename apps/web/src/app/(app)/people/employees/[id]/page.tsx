import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { EmployeeDetail } from '@/components/people/employee-detail';

export const metadata: Metadata = { title: 'Employee' };

/** `params` is async in this version of Next — see apps/web/AGENTS.md. */
export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageGuard permission={PERMISSIONS.EMPLOYEE_READ} title="You can't view employees">
      <EmployeeDetail id={id} />
    </PageGuard>
  );
}
