'use client';

import { useState } from 'react';
import { Bot, Pencil, Plus, Trash2 } from 'lucide-react';
import { PERMISSIONS, type ChannelAgentDto } from '@saas/shared';
import { useChannelAgents, useDeleteChannelAgent } from '@/hooks/use-channel-agents';
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
import { AgentFormDialog } from './agent-form-dialog';
import { AgentTryMessage } from './agent-try-message';
import { AGENT_CHANNEL_LABELS, AGENT_KIND_LABELS, toolLabel } from './agent-labels';

const TITLE = '3. Agents';

export function AgentsView() {
  const { data: agents, isPending } = useChannelAgents();
  const remove = useDeleteChannelAgent();
  const [editing, setEditing] = useState<ChannelAgentDto | null | undefined>(undefined);

  if (isPending) {
    return (
      <>
        <PageHeader title={TITLE} />
        <Skeleton className="h-64 w-full" />
      </>
    );
  }

  const newAgent = (
    <Can permission={PERMISSIONS.AI_MANAGE}>
      <Button onClick={() => setEditing(null)}>
        <Plus className="size-4" />
        New agent
      </Button>
    </Can>
  );

  return (
    <>
      <PageHeader
        title={TITLE}
        description="Give each job its own agent, for example Sales, Support or Purchasing. A message goes to the agent whose job fits; an agent can pass it to another agent or to a person. With no agents, sections 4 and 5 handle customer messages as before."
        actions={newAgent}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4 text-ink-subtle" />
            Your agents
          </CardTitle>
        </CardHeader>

        {!agents || agents.length === 0 ? (
          <EmptyState
            icon={<Bot className="size-8" />}
            title="No agents yet"
            description="Add one to have the AI answer customers in its own words, or to give staff a helper with its own instructions and tools."
            action={newAgent}
          />
        ) : (
          <ul className="divide-y divide-border/25">
            {agents.map((agent) => (
              <li
                key={agent.id}
                className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-ink">{agent.name}</span>
                    <Badge tone="neutral">{AGENT_KIND_LABELS[agent.kind]}</Badge>
                    <Badge tone={agent.isEnabled ? 'success' : 'neutral'}>
                      {agent.isEnabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">{agent.description}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    On: {agent.channels.map((c) => AGENT_CHANNEL_LABELS[c] ?? c).join(', ') || 'no channels'}.
                    Tools: {agent.skills.map(toolLabel).join(', ') || 'none'}. Model:{' '}
                    {agent.model ?? 'default'}.
                  </p>
                </div>

                <Can permission={PERMISSIONS.AI_MANAGE}>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(agent)}>
                      <Pencil className="size-4" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={remove.isPending && remove.variables === agent.id}
                      onClick={() => {
                        if (window.confirm(`Delete the agent "${agent.name}"?`)) {
                          remove.mutate(agent.id);
                        }
                      }}
                    >
                      <Trash2 className="size-4 text-danger" />
                      Delete
                    </Button>
                  </div>
                </Can>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {agents && agents.length > 0 && <AgentTryMessage />}

      <AgentFormDialog
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        agent={editing}
      />
    </>
  );
}
