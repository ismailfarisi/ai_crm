'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import {
  PERMISSIONS,
  type ChannelAgentKind,
  type ChannelAgentTestResultDto,
  type TestChannelAgentPayload,
} from '@saas/shared';
import { api } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/field';
import { agentChannelOptions, toolLabel } from './agent-labels';

const FROM = [
  { value: 'CUSTOMER', label: 'A customer' },
  { value: 'STAFF', label: 'A member of staff (you)' },
];

/** What would happen, in a sentence. */
function describeOutcome(result: ChannelAgentTestResultDto): string {
  const name = result.agent?.name;
  switch (result.outcome) {
    case 'REPLY':
      return `${name} would send this reply:`;
    case 'TOOL':
      return result.tool
        ? `${name} would use "${toolLabel(result.tool)}", show what it is about to do and wait for a YES.`
        : `${name} would take it, but none of its tools fits, so it would reply with what it can do.`;
    case 'HANDOVER':
      return `${name} would pass the conversation to a person in the Inbox.`;
    case 'NO_AGENT':
      return 'No agent would take this message. It would be handled as it is without agents.';
    default:
      return 'The AI could not read the message. Check that a provider is connected, a model is chosen and the spending limit is not reached.';
  }
}

/**
 * Try a message against the saved agents. Nothing is sent, drafted or saved;
 * the AI calls are real.
 */
export function AgentTryMessage() {
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<ChannelAgentKind>('CUSTOMER');
  const [provider, setProvider] = useState<TestChannelAgentPayload['provider']>('WHATSAPP_META');
  const test = useMutation({
    mutationFn: () => api.channelAgents.test({ body: body.trim(), provider, kind }),
  });
  const result = test.data;

  return (
    <Can permission={PERMISSIONS.AI_MANAGE}>
      <section
        aria-labelledby="agent-try-message"
        className="space-y-4 rounded-2xl border border-border/40 bg-surface/85 p-5 shadow-xs"
      >
        <div>
          <h3
            id="agent-try-message"
            className="flex items-center gap-2 text-sm font-semibold text-ink"
          >
            <FlaskConical className="size-4 text-ink-subtle" aria-hidden />
            Try a message with your agents
          </h3>
          <p className="mt-1 text-xs text-ink-muted">
            See which agent would take a message and what it would do. Nothing is sent or saved. It
            uses a few AI calls.
          </p>
        </div>

        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) test.mutate();
          }}
        >
          <Textarea
            label="Message"
            placeholder="Hi, can I get a price for 500 rigid boxes?"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-24"
          />
          <div className="space-y-3">
            <Select
              label="From"
              value={kind}
              options={FROM}
              onChange={(e) => {
                setKind(e.target.value as ChannelAgentKind);
                setProvider('WHATSAPP_META');
              }}
            />
            <Select
              label="Sent on"
              value={provider}
              options={agentChannelOptions(kind)}
              onChange={(e) => setProvider(e.target.value as TestChannelAgentPayload['provider'])}
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
            {result.transfers.map((transfer, i) => (
              <p key={i} className="text-ink-muted">
                {transfer.from} would pass it to {transfer.to}
                {transfer.reason ? `: ${transfer.reason}` : '.'}
              </p>
            ))}
            {result.actions.map((action) => (
              <p key={action} className="text-ink-muted">
                {action}
              </p>
            ))}
            <p className="font-medium text-ink">{describeOutcome(result)}</p>
            {result.outcome === 'REPLY' && result.reply && (
              <blockquote className="whitespace-pre-wrap border-l-2 border-border pl-3 text-ink-muted">
                {result.reply}
              </blockquote>
            )}
            {result.outcome === 'HANDOVER' && result.handoverSummary && (
              <p className="text-ink-muted">
                <span className="font-medium text-ink">Note for staff: </span>
                {result.handoverSummary}
              </p>
            )}
          </div>
        )}
      </section>
    </Can>
  );
}
