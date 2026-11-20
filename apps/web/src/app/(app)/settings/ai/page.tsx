import type { Metadata } from 'next';
import { PERMISSIONS } from '@saas/shared';
import { PageGuard } from '@/components/auth/page-guard';
import { AiBudgetView } from '@/components/settings/ai-budget-view';
import { AiHowItWorks } from '@/components/settings/ai-how-it-works';
import { AiTryMessage } from '@/components/settings/ai-try-message';
import { AiProvidersView } from '@/components/settings/ai-providers/ai-providers-view';
import { AiModelsView } from '@/components/settings/ai-models/ai-models-view';
import { AiAgentsView } from '@/components/settings/ai-agents/ai-agents-view';
import { IntentAgentConfigView } from '@/components/settings/intent-agent-config-view';

export const metadata: Metadata = { title: 'AI Settings' };

export default function AiBudgetPage() {
  return (
    <PageGuard permission={PERMISSIONS.AI_MANAGE} title="You can't manage AI settings">
      <div className="space-y-10">
        <AiHowItWorks />
        <AiProvidersView />
        <AiModelsView />
        <IntentAgentConfigView />
        <AiAgentsView />
        <AiTryMessage />
        <AiBudgetView />
      </div>
    </PageGuard>
  );
}
