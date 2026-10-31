'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Mail, MessageSquare, Send, Settings, TestTube, Zap } from 'lucide-react';
import { api, queryKeys, type ChannelConfigDto } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';

interface ChannelCardProps {
  config: ChannelConfigDto;
  onConfigure: (config: ChannelConfigDto) => void;
}

const PROVIDER_INFO: Record<
  ChannelConfigDto['provider'],
  { title: string; shortName: string; description: string; icon: typeof MessageSquare }
> = {
  WHATSAPP_META: {
    title: 'Meta WhatsApp Cloud API',
    shortName: 'WhatsApp',
    description: 'Send & receive WhatsApp messages using Meta Cloud API.',
    icon: MessageSquare,
  },
  TELEGRAM: {
    title: 'Telegram Bot',
    shortName: 'Telegram',
    description: 'Receive messages and reply to customers via a Telegram Bot.',
    icon: Send,
  },
  EMAIL_SMTP: {
    title: 'SMTP Email',
    shortName: 'SMTP email',
    description: 'Custom SMTP server for outbound email communications.',
    icon: Mail,
  },
  EMAIL_RESEND: {
    title: 'Resend Email',
    shortName: 'Resend email',
    description: 'Transactional email driver powered by Resend API.',
    icon: Zap,
  },
};

export function ChannelCard({ config, onConfigure }: ChannelCardProps) {
  const queryClient = useQueryClient();
  const info = PROVIDER_INFO[config.provider] ?? {
    title: config.provider,
    shortName: config.provider,
    description: 'Channel provider integration.',
    icon: MessageSquare,
  };
  const Icon = info.icon;

  const toggleMutation = useMutation({
    mutationFn: (nextEnabled: boolean) =>
      api.channels.saveConfig(config.provider, {
        isEnabled: nextEnabled,
        credentials: config.credentials ?? undefined,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.channels });
      toast.success(
        data.isEnabled
          ? `${info.title} enabled`
          : `${info.title} disabled`,
      );
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not update channel status',
      );
    },
  });

  const testMutation = useMutation({
    mutationFn: () => api.channels.testConfig(config.provider),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.channels });
      if (result.success) {
        toast.success(result.message || `Connected to ${info.title} successfully!`);
      } else {
        toast.error(result.message || `Failed to connect to ${info.title}.`);
      }
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : 'Connection test failed',
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
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-muted text-ink ring-1 ring-border">
            <Icon className="size-5" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">{info.title}</CardTitle>
            <Badge tone={badgeTone} className="mt-1">
              {badgeLabel}
            </Badge>
          </div>
        </div>

        {/* The label is the 44px hit area; the track inside it is what shows. */}
        <label
          className="inline-flex h-11 shrink-0 cursor-pointer items-center has-disabled:cursor-not-allowed"
          title={isUnconfigured ? 'Add the credentials first' : undefined}
        >
          <input
            type="checkbox"
            role="switch"
            aria-label={`Enable ${info.shortName}`}
            className="peer sr-only"
            checked={config.isEnabled}
            disabled={isUnconfigured || toggleMutation.isPending}
            onChange={(e) => toggleMutation.mutate(e.target.checked)}
          />
          <span
            aria-hidden
            className="relative h-6 w-11 rounded-full border border-border-control bg-surface-muted transition-colors after:absolute after:top-[2px] after:left-[2px] after:size-[18px] after:rounded-full after:border after:border-border-control after:bg-surface after:transition-transform after:content-[''] peer-checked:border-brand peer-checked:bg-brand peer-checked:after:translate-x-5 peer-checked:after:border-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface peer-disabled:opacity-50"
          />
        </label>
      </CardHeader>

      <CardBody className="space-y-4 pt-2">
        <p className="text-sm text-ink-muted">{info.description}</p>

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
            Test Connection
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
