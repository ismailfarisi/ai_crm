import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { TeamView } from '@/components/settings/team-view';

export const metadata: Metadata = { title: 'Team' };

export default function TeamPage() {
  return (
    <PageGuard permission={PERMISSIONS.USER_READ} title="You can't view the team">
      <TeamView />
    </PageGuard>
  );
}
