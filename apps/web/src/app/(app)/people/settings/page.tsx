import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { PayrollSettingsView } from '@/components/people/payroll-settings-view';

export const metadata: Metadata = { title: 'Payroll settings' };

export default function PayrollSettingsPage() {
  return (
    <PageGuard permission={PERMISSIONS.PAYROLL_READ} title="You can't view payroll settings">
      <PayrollSettingsView />
    </PageGuard>
  );
}
