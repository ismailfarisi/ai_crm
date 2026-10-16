import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { PageHeader } from '@/components/ui/primitives';
import { PeopleNav } from '@/components/people/people-nav';

export const metadata: Metadata = { title: 'Payroll' };

/** Placeholder so the People sub-nav does not dead-end; the payroll runs UI replaces it. */
export default function PayrollPage() {
  return (
    <PageGuard permission={PERMISSIONS.PAYROLL_READ} title="You can't view payroll">
      <div className="space-y-6">
        <PageHeader title="Payroll" description="Monthly payroll runs." />
        <PeopleNav />
      </div>
    </PageGuard>
  );
}
