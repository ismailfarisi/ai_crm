import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { TeamsView } from '@/components/settings/teams-view';

export const metadata: Metadata = { title: 'Teams' };

export default function TeamsPage() {
  return (
    <PageGuard permission={PERMISSIONS.USER_READ} title="You can't view teams">
      <TeamsView />
    </PageGuard>
  );
}
