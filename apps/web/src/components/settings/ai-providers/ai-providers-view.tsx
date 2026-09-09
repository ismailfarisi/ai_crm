'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys, type AiConfigDto } from '@/lib/api/endpoints';
import { PageHeader, Skeleton } from '@/components/ui/primitives';
import { AiProviderCard } from './ai-provider-card';
import { AiProviderConfigModal } from './ai-provider-config-modal';

const DEFAULT_PROVIDERS: AiConfigDto['provider'][] = ['OPENAI', 'ANTHROPIC', 'OPENROUTER'];

export function AiProvidersView() {
  const [editingConfig, setEditingConfig] = useState<AiConfigDto | null>(null);

  const { data: configs, isPending } = useQuery({
    queryKey: queryKeys.aiConfigs,
    queryFn: api.ai.listConfigs,
  });

  if (isPending) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="AI Providers"
          description="Connect OpenAI, Anthropic, or any open model via OpenRouter to power receipt scanning, chat commands, and future AI features."
        />
        <div className="grid gap-6 md:grid-cols-3">
          {DEFAULT_PROVIDERS.map((provider) => (
            <Skeleton key={provider} className="h-56 w-full rounded-card" />
          ))}
        </div>
      </div>
    );
  }

  const configMap = new Map((configs ?? []).map((c) => [c.provider, c]));
  const displayConfigs: AiConfigDto[] = DEFAULT_PROVIDERS.map((provider) => {
    const existing = configMap.get(provider);
    if (existing) return existing;
    return {
      id: null,
      organizationId: '',
      provider,
      isEnabled: false,
      isDefault: false,
      status: 'unconfigured',
      credentials: null,
      lastTestedAt: null,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Providers"
        description="Connect OpenAI, Anthropic, or any open model via OpenRouter to power receipt scanning, chat commands, and future AI features."
      />

      <div className="grid gap-6 md:grid-cols-3">
        {displayConfigs.map((config) => (
          <AiProviderCard
            key={config.provider}
            config={config}
            onConfigure={(cfg) => setEditingConfig(cfg)}
          />
        ))}
      </div>

      <AiProviderConfigModal
        open={Boolean(editingConfig)}
        onClose={() => setEditingConfig(null)}
        config={editingConfig}
      />
    </div>
  );
}
