import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { InboxWorkspace } from '@/components/inbox/inbox-workspace';

export const metadata: Metadata = { title: 'Inbox' };

export default function InboxPage() {
  return (
    <PageGuard permission={PERMISSIONS.CHANNEL_READ} title="You can't view messages">
      <InboxWorkspace />
    </PageGuard>
  );
}
