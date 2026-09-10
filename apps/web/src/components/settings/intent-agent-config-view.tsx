'use client';

import { useState } from 'react';
import { MessageCircleQuestion } from 'lucide-react';
import {
  PERMISSIONS,
  type IntentAgentConfigDto,
  type UpsertIntentAgentConfigPayload,
} from '@saas/shared';
import { useIntentAgentConfig, useUpdateIntentAgentConfig } from '@/hooks/use-intent-agent-config';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/field';
import { PageHeader, Skeleton } from '@/components/ui/primitives';

const PROVIDER_OPTIONS = [
  { value: 'TELEGRAM', label: 'Telegram' },
  { value: 'WHATSAPP_META', label: 'WhatsApp' },
  { value: 'EMAIL_SMTP', label: 'Email (SMTP)' },
  { value: 'EMAIL_RESEND', label: 'Email (Resend)' },
];

export function IntentAgentConfigView() {
  const { data: config, isPending } = useIntentAgentConfig();
  const update = useUpdateIntentAgentConfig();

  const [isEnabled, setIsEnabled] = useState(true);
  const [maxTurns, setMaxTurns] = useState(5);
  const [replyTimeoutMinutes, setReplyTimeoutMinutes] = useState(15);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [eligibleProviders, setEligibleProviders] = useState<string[]>([
    'TELEGRAM',
    'WHATSAPP_META',
  ]);

  // Sync the form with server data whenever it changes, same pattern as
  // ai-budget-view.tsx — adjusted during render so no stale draft is painted.
  const [lastSynced, setLastSynced] = useState<IntentAgentConfigDto | null>(null);
  if (config && config !== lastSynced) {
    setLastSynced(config);
    setIsEnabled(config.isEnabled);
    setMaxTurns(config.maxTurns);
    setReplyTimeoutMinutes(config.replyTimeoutMinutes);
    setSystemPrompt(config.systemPrompt ?? '');
    setEligibleProviders(config.eligibleProviders);
  }

  const toggleProvider = (value: string) => {
    setEligibleProviders((prev) =>
      prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await update.mutateAsync({
      isEnabled,
      maxTurns,
      replyTimeoutMinutes,
      systemPrompt: systemPrompt.trim() || null,
      eligibleProviders:
        eligibleProviders as UpsertIntentAgentConfigPayload['eligibleProviders'],
    });
  };

  if (isPending) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Intent agent"
          description="Chats to clarify what a customer wants before handing off to a specialist agent."
        />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Intent agent"
        description="When the classifier isn't confident, this agent asks a clarifying question and waits for a reply — up to a turn limit — before handing off to the matching AI agent below."
      />

      <Can permission={PERMISSIONS.AI_MANAGE}>
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-border/40 bg-surface/85 p-5 shadow-xs"
        >
          <div className="flex items-center gap-2">
            <input
              id="intent-agent-enabled"
              type="checkbox"
              className="size-4 rounded border-border accent-brand"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
            />
            <label htmlFor="intent-agent-enabled" className="text-sm font-medium text-ink cursor-pointer">
              Enabled — otherwise every message gets a single classification pass with no back-and-forth
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="max-turns" className="block text-xs font-bold text-ink">
                Max clarifying turns
              </label>
              <Input
                id="max-turns"
                type="number"
                min={1}
                max={10}
                value={maxTurns}
                onChange={(e) => setMaxTurns(parseInt(e.target.value, 10) || 1)}
                required
              />
            </div>

            <div>
              <label htmlFor="reply-timeout" className="block text-xs font-bold text-ink">
                Reply timeout (minutes)
              </label>
              <Input
                id="reply-timeout"
                type="number"
                min={1}
                max={1440}
                value={replyTimeoutMinutes}
                onChange={(e) => setReplyTimeoutMinutes(parseInt(e.target.value, 10) || 1)}
                required
              />
            </div>
          </div>

          <Textarea
            label="System prompt override"
            hint="Leave blank to use the default classification prompt."
            placeholder="You are classifying what a customer wants..."
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
          />

          <fieldset>
            <legend className="mb-2 text-xs font-bold text-ink">Eligible channels</legend>
            <div className="grid grid-cols-2 gap-2">
              {PROVIDER_OPTIONS.map((provider) => (
                <label
                  key={provider.value}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-surface-muted"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-brand)]"
                    checked={eligibleProviders.includes(provider.value)}
                    onChange={() => toggleProvider(provider.value)}
                  />
                  {provider.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex justify-end border-t border-border/25 pt-3">
            <Button type="submit" variant="primary" size="sm" loading={update.isPending}>
              <MessageCircleQuestion className="size-4" />
              Save
            </Button>
          </div>
        </form>
      </Can>
    </div>
  );
}
