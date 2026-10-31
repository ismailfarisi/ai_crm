'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Brain, Network, Settings, Star, TestTube, Cpu } from 'lucide-react';
import { api, queryKeys, type AiConfigDto } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AiProviderCardProps {
  config: AiConfigDto;
  onConfigure: (config: AiConfigDto) => void;
}

const PROVIDER_INFO: Record<
  AiConfigDto['provider'],
  { title: string; description: string; icon: typeof Cpu }
> = {
  OPENAI: {
    title: 'OpenAI',
    description: 'GPT models — e.g. gpt-4o, gpt-4o-mini.',
    icon: Cpu,
  },
  ANTHROPIC: {
    title: 'Anthropic',
    description: 'Claude models — e.g. claude-sonnet-5.',
    icon: Brain,
  },
  OPENROUTER: {
    title: 'OpenRouter',
    description: 'Any open or third-party model routed through OpenRouter.',
    icon: Network,
  },
};

export function AiProviderCard({ config, onConfigure }: AiProviderCardProps) {
  const queryClient = useQueryClient();
  const info = PROVIDER_INFO[config.provider] ?? {
    title: config.provider,
    description: 'AI provider integration.',
    icon: Cpu,
  };
  const Icon = info.icon;

  const toggleMutation = useMutation({
    mutationFn: (nextEnabled: boolean) =>
      api.ai.saveConfig(config.provider, {
        isEnabled: nextEnabled,
        credentials: config.credentials ?? undefined,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.aiConfigs });
      toast.success(data.isEnabled ? `${info.title} enabled` : `${info.title} disabled`);
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not update provider status',
      );
    },
  });

  const testMutation = useMutation({
    mutationFn: () => api.ai.testConfig(config.provider),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.aiConfigs });
      if (result.success) {
        toast.success(result.message || `Connected to ${info.title} successfully!`);
      } else {
        toast.error(result.message || `Failed to connect to ${info.title}.`);
      }
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Connection test failed');
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: () => api.ai.setDefaultConfig(config.provider),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.aiConfigs });
      toast.success(`${info.title} is now the default provider`);
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not set default provider',
      );
    },
  });

  const isUnconfigured = config.status === 'unconfigured';
  const isError = config.status === 'error';

  let badgeTone: 'warning' | 'neutral' | 'danger' | 'success' = 'neutral';
  let badgeLabel = 'Disabled';

  if (isUnconfigured) {
    badgeTone = 'warning';
    badgeLabel = 'Unconfigured';
  } else if (!config.isEnabled) {
    badgeTone = 'neutral';
    badgeLabel = 'Disabled';
  } else if (isError) {
    badgeTone = 'danger';
    badgeLabel = 'Error';
  } else {
    badgeTone = 'success';
    badgeLabel = 'Configured';
  }

  return (
    <Card className="flex flex-col justify-between transition-shadow hover:shadow-md">
      <CardHeader className="flex items-start justify-between gap-3 pb-3">
        <div className="flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-ink ring-1 ring-brand/20">
            <Icon className="size-5" aria-hidden />
          </div>
          <div>
            <CardTitle>{info.title}</CardTitle>
            <div className="mt-1 flex items-center gap-1.5">
              <Badge tone={badgeTone}>{badgeLabel}</Badge>
              {config.isDefault && <Badge tone="brand">Default</Badge>}
            </div>
          </div>
        </div>

        {/* A 40px hit area around the small switch; the name stays "Enable
            OpenAI" and the switch's own checked state says whether it is. */}
        <label
          className="-m-2 inline-flex min-h-10 min-w-10 shrink-0 cursor-pointer items-center justify-center p-2 has-[:disabled]:cursor-not-allowed"
          title={isUnconfigured ? 'Configure credentials first' : undefined}
        >
          <input
            type="checkbox"
            role="switch"
            aria-label={`Enable ${info.title}`}
            className="peer sr-only"
            checked={config.isEnabled}
            disabled={isUnconfigured || toggleMutation.isPending}
            onChange={(e) => toggleMutation.mutate(e.target.checked)}
          />
          <span
            aria-hidden
            className="relative h-5 w-9 rounded-full border border-border-control bg-surface-muted transition-colors after:absolute after:top-[1px] after:left-[1px] after:size-4 after:rounded-full after:border after:border-border-control after:bg-surface after:transition-transform after:content-[''] peer-checked:border-brand peer-checked:bg-brand peer-checked:after:translate-x-4 peer-checked:after:border-surface peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-ring peer-disabled:opacity-50"
          />
        </label>
      </CardHeader>

      <CardBody className="space-y-4 pt-2">
        <p className="text-sm text-ink-muted">{info.description}</p>

        {config.credentials?.model && (
          <p className="text-xs text-ink-subtle">
            Model: <span className="font-mono">{config.credentials.model}</span>
          </p>
        )}

        {config.lastTestedAt && (
          <p className="text-xs text-ink-subtle">
            Last tested:{' '}
            {new Date(config.lastTestedAt).toLocaleString(undefined, {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </p>
        )}

        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={isUnconfigured}
            loading={testMutation.isPending}
            onClick={() => testMutation.mutate()}
          >
            <TestTube className="size-3.5" />
            Test
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={!config.isEnabled || config.isDefault}
            loading={setDefaultMutation.isPending}
            onClick={() => setDefaultMutation.mutate()}
            title={config.isDefault ? 'Already the default provider' : 'Set as default'}
          >
            <Star className={cn('size-3.5', config.isDefault && 'fill-current')} />
            Default
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            onClick={() => onConfigure(config)}
          >
            <Settings className="size-3.5" />
            Configure
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
