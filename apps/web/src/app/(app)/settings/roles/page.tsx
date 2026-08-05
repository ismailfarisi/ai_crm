import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { RolesView } from '@/components/settings/roles-view';

export const metadata: Metadata = { title: 'Roles & permissions' };

export default function RolesPage() {
  return (
    <PageGuard permission={PERMISSIONS.ROLE_READ} title="You can't manage roles">
      <RolesView />
    </PageGuard>
  );
}
