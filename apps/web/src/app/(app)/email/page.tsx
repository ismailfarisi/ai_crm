import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { MessagesSwitcher } from '@/components/layout/messages-switcher';
import { EmailWorkspace } from '@/components/email/email-workspace';

export const metadata: Metadata = { title: 'Email' };

export default function EmailPage() {
  return (
    <PageGuard permission={PERMISSIONS.EMAIL_READ} title="You can't view email">
      <MessagesSwitcher />
      <EmailWorkspace />
    </PageGuard>
  );
}
