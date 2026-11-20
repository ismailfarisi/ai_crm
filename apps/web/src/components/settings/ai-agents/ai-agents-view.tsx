'use client';

import { useState } from 'react';
import { Bot, Pencil, Plus, Trash2 } from 'lucide-react';
import { PERMISSIONS, type AiAgentDto } from '@saas/shared';
import { useAiAgents, useDeleteAiAgent } from '@/hooks/use-ai-agents';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Skeleton,
} from '@/components/ui/primitives';
import { AiAgentFormDialog } from './ai-agent-form-dialog';

const INTENT_LABELS: Record<string, string> = {
  GENERAL_QUESTION: 'General question',
  QUOTATION_REQUEST: 'Quotation request',
  ORDER_STATUS: 'Order status',
  PRICING_QUESTION: 'Pricing question',
  COMPLAINT: 'Complaint',
  SUPPORT_REQUEST: 'Support request',
  SCHEDULING: 'Scheduling',
  SPAM: 'Spam',
  OTHER: 'Other',
};

const ACTION_LABELS: Record<string, string> = {
  AUTO_ACK: 'send a set reply',
  CREATE_DRAFT_QUOTE: 'create a draft quote',
};

const CHANNEL_LABELS: Record<string, string> = {
  EMAIL_SMTP: 'Email (SMTP)',
  EMAIL_RESEND: 'Email (Resend)',
  WHATSAPP_META: 'WhatsApp',
  TELEGRAM: 'Telegram',
  SLACK: 'Slack',
};

export function AiAgentsView() {
  const { data: agents, isPending } = useAiAgents();
  const remove = useDeleteAiAgent();
  const [editing, setEditing] = useState<AiAgentDto | null | undefined>(undefined);

  if (isPending) {
    return (
      <>
        <PageHeader title="4. Automatic replies" />
        <Skeleton className="h-64 w-full" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="4. Automatic replies"
        description="What happens by itself once the AI knows what a customer wants. Add one rule for each kind of request; anything without a rule goes to a person."
        actions={
          <Can permission={PERMISSIONS.AI_MANAGE}>
            <Button onClick={() => setEditing(null)}>
              <Plus className="size-4" />
              New rule
            </Button>
          </Can>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4 text-ink-subtle" />
            Rules
          </CardTitle>
        </CardHeader>

        {!agents || agents.length === 0 ? (
          <EmptyState
            icon={<Bot className="size-8" />}
            title="No rules yet"
            description="Add one so that, for example, a question about an order gets an automatic reply, or a request for a quote creates a draft quote."
            action={
              <Can permission={PERMISSIONS.AI_MANAGE}>
                <Button onClick={() => setEditing(null)}>
                  <Plus className="size-4" />
                  New rule
                </Button>
              </Can>
            }
          />
        ) : (
          <ul className="divide-y divide-border/25">
            {agents.map((agent) => (
              <li
                key={agent.id}
                className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-ink">{agent.name}</span>
                    <Badge tone={agent.isEnabled ? 'success' : 'neutral'}>
                      {agent.isEnabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">
                    When it is: {INTENT_LABELS[agent.intent] ?? agent.intent}. Then:{' '}
                    {ACTION_LABELS[agent.actionType] ?? agent.actionType}. Only when the AI is at
                    least {Math.round(agent.confidenceThreshold * 100)}% sure. On:{' '}
                    {agent.eligibleProviders.map((p) => CHANNEL_LABELS[p] ?? p).join(', ') ||
                      'no channels'}
                    .
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Can permission={PERMISSIONS.AI_MANAGE}>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(agent)}>
                      <Pencil className="size-4" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={remove.isPending}
                      onClick={() => remove.mutate(agent.id)}
                    >
                      <Trash2 className="size-4 text-danger" />
                      Delete
                    </Button>
                  </Can>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <AiAgentFormDialog
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        agent={editing}
      />
    </>
  );
}
