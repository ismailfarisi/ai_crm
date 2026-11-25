import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { CostingRulesView } from '@/components/settings/costing-rules-view';

export const metadata: Metadata = { title: 'Costing rules' };

export default function CostingRulesPage() {
  return (
    <PageGuard permission={PERMISSIONS.CATALOG_READ} title="You can't view the costing rules">
      <CostingRulesView />
    </PageGuard>
  );
}
