import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { AiBudgetView } from '@/components/settings/ai-budget-view';

export const metadata: Metadata = { title: 'AI Cost Guard' };

export default function AiBudgetPage() {
  return (
    <PageGuard permission={PERMISSIONS.AI_MANAGE} title="You can't manage the AI budget">
      <AiBudgetView />
    </PageGuard>
  );
}
