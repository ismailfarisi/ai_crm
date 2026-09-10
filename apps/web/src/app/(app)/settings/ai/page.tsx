import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { AiBudgetView } from '@/components/settings/ai-budget-view';
import { AiProvidersView } from '@/components/settings/ai-providers/ai-providers-view';
import { AiAgentsView } from '@/components/settings/ai-agents/ai-agents-view';

export const metadata: Metadata = { title: 'AI Settings' };

export default function AiBudgetPage() {
  return (
    <PageGuard permission={PERMISSIONS.AI_MANAGE} title="You can't manage AI settings">
      <div className="space-y-10">
        <AiProvidersView />
        <AiAgentsView />
        <AiBudgetView />
      </div>
    </PageGuard>
  );
}
