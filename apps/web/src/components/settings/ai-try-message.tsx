'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import {
  CHANNEL_HANDOVER_REASON_LABELS,
  PERMISSIONS,
  type ChannelAiTestResultDto,
  type TestChannelAiPayload,
} from '@saas/shared';
import { api } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/field';

const CHANNELS = [
  { value: 'WHATSAPP_META', label: 'WhatsApp' },
  { value: 'TELEGRAM', label: 'Telegram' },
  { value: 'SLACK', label: 'Slack' },
  { value: 'EMAIL_SMTP', label: 'Email (SMTP)' },
  { value: 'EMAIL_RESEND', label: 'Email (Resend)' },
];

export const INTENT_LABELS: Record<string, string> = {
  GENERAL_QUESTION: 'A general question',
  QUOTATION_REQUEST: 'A request for a quote',
  ORDER_STATUS: 'A question about an order',
  PRICING_QUESTION: 'A question about prices',
  COMPLAINT: 'A complaint',
  HUMAN_REQUEST: 'A request to talk to a person',
  SUPPORT_REQUEST: 'A request for help',
  SCHEDULING: 'A scheduling request',
  SPAM: 'Spam',
  OTHER: 'Something else',
};

const ACTION_LABELS: Record<string, string> = {
  AUTO_ACK: 'send this reply',
  CREATE_DRAFT_QUOTE: 'create a draft quote',
};

/** What would happen, in a sentence. */
function describeOutcome(result: ChannelAiTestResultDto): string {
  switch (result.outcome) {
    case 'RULE': {
      const rule = result.rule!;
      const does = ACTION_LABELS[rule.actionType] ?? rule.actionType;
      const after = result.thenHandover
        ? ' The conversation would then go to a person.'
        : '';
      return `The rule "${rule.name}" would ${does}.${after}`;
    }
    case 'ASK':
      return 'The AI would ask the customer this question and wait for the answer.';
    case 'HANDOVER':
      return `The conversation would go to a person in the Inbox. ${
        result.handoverReason ? `${CHANNEL_HANDOVER_REASON_LABELS[result.handoverReason]}.` : ''
      }`.trim();
    default:
      return 'The AI could not read the message. Check that a provider is connected, a model is chosen and the spending limit is not reached.';
  }
}

/**
 * Try a customer message against the current settings. Nothing is sent and
 * nothing is saved; it costs one AI call.
 */
export function AiTryMessage() {
  const [body, setBody] = useState('');
  const [provider, setProvider] = useState<TestChannelAiPayload['provider']>('WHATSAPP_META');
  const test = useMutation({
    mutationFn: () => api.intentAgentConfig.test({ body: body.trim(), provider }),
  });
  const result = test.data;

  return (
    <Can permission={PERMISSIONS.AI_MANAGE}>
      <section
        aria-labelledby="ai-try-message"
        className="space-y-4 rounded-2xl border border-border/40 bg-surface/85 p-5 shadow-xs"
      >
        <div>
          <h3 id="ai-try-message" className="flex items-center gap-2 text-sm font-semibold text-ink">
            <FlaskConical className="size-4 text-ink-subtle" aria-hidden />
            Try a message
          </h3>
          <p className="mt-1 text-xs text-ink-muted">
            Type what a customer might send to see what the AI would do with your saved settings.
            Nothing is sent or saved. It uses one AI call.
          </p>
        </div>

        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) test.mutate();
          }}
        >
          <Textarea
            label="Customer message"
            placeholder="Hi, where is my order for 500 boxes?"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-16"
          />
          <div className="space-y-3">
            <Select
              label="Sent on"
              value={provider}
              onChange={(e) => setProvider(e.target.value as TestChannelAiPayload['provider'])}
              options={CHANNELS}
            />
            <Button type="submit" loading={test.isPending} disabled={!body.trim()} className="w-full">
              See what happens
            </Button>
          </div>
        </form>

        {test.isError && (
          <p className="text-sm text-danger" role="alert">
            {test.error instanceof ApiError ? test.error.message : 'Could not try the message.'}
          </p>
        )}

        {result && (
          <div
            role="status"
            className="space-y-2 rounded-xl border border-border/40 bg-surface-muted/40 p-4 text-sm"
          >
            {result.intent && (
              <p className="text-ink-muted">
                <span className="font-medium text-ink">The AI read this as: </span>
                {INTENT_LABELS[result.intent] ?? result.intent}
                {result.confidence != null && ` (${Math.round(result.confidence * 100)}% sure)`}
                {result.summary ? `. ${result.summary}` : ''}
              </p>
            )}
            <p className="font-medium text-ink">{describeOutcome(result)}</p>
            {result.outcome === 'RULE' && result.rule?.reply && (
              <blockquote className="border-l-2 border-border pl-3 text-ink-muted">
                {result.rule.reply}
              </blockquote>
            )}
            {result.outcome === 'ASK' && result.question && (
              <blockquote className="border-l-2 border-border pl-3 text-ink-muted">
                {result.question}
              </blockquote>
            )}
          </div>
        )}
      </section>
    </Can>
  );
}
