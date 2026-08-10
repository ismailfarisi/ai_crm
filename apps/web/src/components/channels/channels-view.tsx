'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys, type ChannelConfigDto } from '@/lib/api/endpoints';
import { PageHeader, Skeleton } from '@/components/ui/primitives';
import { ChannelCard } from './channel-card';
import { ChannelConfigModal } from './channel-config-modal';

const DEFAULT_PROVIDERS: ChannelConfigDto['provider'][] = [
  'WHATSAPP_META',
  'TELEGRAM',
  'EMAIL_SMTP',
  'EMAIL_RESEND',
];

export function ChannelsView() {
  const [editingConfig, setEditingConfig] = useState<ChannelConfigDto | null>(null);

  const { data: configs, isPending } = useQuery({
    queryKey: queryKeys.channels,
    queryFn: api.channels.list,
  });

  if (isPending) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Communication Channels"
          description="Configure WhatsApp, Telegram, SMTP, and Resend integrations for multi-channel messaging."
        />
        <div className="grid gap-6 md:grid-cols-2">
          {DEFAULT_PROVIDERS.map((provider) => (
            <Skeleton key={provider} className="h-56 w-full rounded-card" />
          ))}
        </div>
      </div>
    );
  }

  // Ensure all 4 providers are displayed even if not yet saved on server
  const configMap = new Map((configs ?? []).map((c) => [c.provider, c]));
  const displayConfigs: ChannelConfigDto[] = DEFAULT_PROVIDERS.map((provider) => {
    const existing = configMap.get(provider);
    if (existing) return existing;
    return {
      id: null,
      organizationId: '',
      provider,
      isEnabled: false,
      status: 'unconfigured',
      credentials: null,
      webhookSecret: null,
      lastTestedAt: null,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Communication Channels"
        description="Configure WhatsApp, Telegram, SMTP, and Resend integrations for multi-channel messaging."
      />

      <div className="grid gap-6 md:grid-cols-2">
        {displayConfigs.map((config) => (
          <ChannelCard
            key={config.provider}
            config={config}
            onConfigure={(cfg) => setEditingConfig(cfg)}
          />
        ))}
      </div>

      <ChannelConfigModal
        open={Boolean(editingConfig)}
        onClose={() => setEditingConfig(null)}
        config={editingConfig}
      />
    </div>
  );
}
