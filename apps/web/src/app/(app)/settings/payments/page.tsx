import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { PaymentsSettingsView } from '@/components/settings/payments/payments-settings-view';

export const metadata: Metadata = { title: 'Online payments' };

export default function Page() {
  return (
    <PageGuard permission={PERMISSIONS.ORG_MANAGE_PAYMENTS} title="You can't manage online payments">
      <PaymentsSettingsView />
    </PageGuard>
  );
}
