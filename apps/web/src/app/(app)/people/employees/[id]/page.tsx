import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { EmployeeDetail } from '@/components/people/employee-detail';
import { isEmployeeTab } from '@/components/people/employee-tabs';

export const metadata: Metadata = { title: 'Employee' };

/** `params` and `searchParams` are async in this version of Next — see apps/web/AGENTS.md. */
export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  return (
    <PageGuard permission={PERMISSIONS.EMPLOYEE_READ} title="You can't view employees">
      <EmployeeDetail id={id} initialTab={isEmployeeTab(tab) ? tab : undefined} />
    </PageGuard>
  );
}
