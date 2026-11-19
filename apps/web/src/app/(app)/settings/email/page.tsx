import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { EmailAccountsView } from '@/components/settings/email-accounts-view';

export const metadata: Metadata = { title: 'Email accounts' };

export default function EmailSettingsPage() {
  return (
    <PageGuard permission={PERMISSIONS.EMAIL_READ} title="You can't view email accounts">
      <Suspense>
        <EmailAccountsView />
      </Suspense>
    </PageGuard>
  );
}
