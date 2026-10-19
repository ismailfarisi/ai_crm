import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { BranchesView } from '@/components/settings/branches-view';

export const metadata: Metadata = { title: 'Branches' };

export default function BranchesPage() {
  return (
    <PageGuard permission={PERMISSIONS.ORG_READ} title="You can't view branches">
      <BranchesView />
    </PageGuard>
  );
}
