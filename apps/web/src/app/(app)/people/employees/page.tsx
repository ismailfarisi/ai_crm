import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { EmployeesView } from '@/components/people/employees-view';

export const metadata: Metadata = { title: 'Employees' };

export default function EmployeesPage() {
  return (
    <PageGuard permission={PERMISSIONS.EMPLOYEE_READ} title="You can't view employees">
      <EmployeesView />
    </PageGuard>
  );
}
