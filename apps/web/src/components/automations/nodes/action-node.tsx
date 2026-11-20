'use client';

import React from 'react';
import { Globe, Mail, Database, MessageSquareText, Bot } from 'lucide-react';
import type { NodeProps, Node } from '@xyflow/react';
import type { AutomationNodeData, AutomationNodeType } from '@saas/shared';
import { aiAgentStepTask } from '@saas/shared';
import { BaseNode } from './base-node';
import { plainStepName, stepWording } from '../step-wording';
import { agentChoice, useAgentOptions } from '../agent-step/agent-options';

/** Who the AI agent step runs as, and whether it is ready to run. */
function AgentStepPreview({ config }: { config: Record<string, unknown> }) {
  const choice = agentChoice(config.agentId, useAgentOptions());
  const task = aiAgentStepTask({ data: { label: '', config } });
  const agentName =
    choice.state === 'ok' || choice.state === 'off'
      ? choice.agent.name
      : choice.state === 'missing'
        ? 'Deleted agent'
        : choice.state === 'loading'
          ? 'Agent'
          : 'General assistant';
  const problem =
    choice.state === 'missing'
      ? 'Pick another agent'
      : choice.state === 'off'
        ? 'Agent is switched off'
        : !task
          ? 'Needs a task'
          : null;

  return (
    <div className="space-y-1 text-[11px]">
      <div className="flex items-center justify-between gap-2 text-ink-muted">
        <span className="font-semibold text-ink truncate" data-testid="agent-node-agent">
          {agentName}
        </span>
        {problem && (
          <span
            data-testid="agent-node-problem"
            className="shrink-0 rounded bg-danger-soft px-1.5 py-0.5 font-semibold text-danger"
          >
            {problem}
          </span>
        )}
      </div>
      {task && (
        <p className="text-ink-muted line-clamp-2 font-sans" data-testid="agent-node-task">
          {task}
        </p>
      )}
    </div>
  );
}

export interface ActionNodeData extends AutomationNodeData {
  config: {
    method?: string;
    url?: string;
    model?: string;
    prompt?: string;
    to?: string;
    subject?: string;
    action?: string;
    [key: string]: any;
  };
}

export function ActionNode({
  type = 'httpRequestNode',
  data,
  selected,
}: Partial<NodeProps<Node<ActionNodeData>>> & { type?: AutomationNodeType; data?: Partial<ActionNodeData>; selected?: boolean }) {
  const nodeData = data || { label: 'Action Step', config: {} };
  const config = nodeData.config || {};
  const status = (nodeData as any).status || (nodeData as any).executionStatus;

  let Icon = Globe;
  let category = 'Action';
  let defaultTitle = 'Action';
  let iconBg = 'bg-surface-muted';
  let iconColor = 'text-ink';

  let previewContent: React.ReactNode = null;

  switch (type) {
    case 'httpRequestNode':
      Icon = Globe;
      category = 'HTTP';
      defaultTitle = 'HTTP Request';
      iconBg = 'bg-info-soft';
      iconColor = 'text-info';
      previewContent = (
        <div className="flex items-center gap-1.5 font-mono text-[11px] truncate">
          <span className="rounded bg-info-soft px-1 py-0.5 font-semibold text-info text-[11px]">
            {config.method || 'GET'}
          </span>
          <span className="text-ink-muted truncate">{config.url || 'https://api.example.com'}</span>
        </div>
      );
      break;

    case 'aiPromptNode':
      Icon = MessageSquareText;
      category = 'AI';
      defaultTitle = 'AI Prompt / LLM';
      iconBg = 'bg-info-soft';
      iconColor = 'text-info';
      previewContent = (
        <div className="space-y-1 text-[11px]">
          <div className="flex items-center justify-between text-ink-muted">
            <span>Model:</span>
            <span className="font-mono text-[11px] font-semibold text-info bg-info-soft px-1.5 py-0.5 rounded border border-info/20">
              {config.model || 'gpt-4o-mini'}
            </span>
          </div>
          <p className="text-ink-muted truncate font-sans text-[11px]">
            {config.prompt ? `"${config.prompt}"` : 'Generate completion...'}
          </p>
        </div>
      );
      break;

    case 'aiAgentNode':
      Icon = Bot;
      category = 'AI agent';
      defaultTitle = 'AI agent';
      iconBg = 'bg-brand-soft';
      iconColor = 'text-ink';
      previewContent = <AgentStepPreview config={config} />;
      break;

    case 'sendEmailNode':
      Icon = Mail;
      category = 'Email';
      defaultTitle = 'Send Email';
      iconBg = 'bg-danger-soft';
      iconColor = 'text-danger';
      previewContent = (
        <div className="space-y-0.5 text-[11px] truncate">
          <div className="text-ink font-medium truncate">
            To: <span className="text-ink-muted">{config.to || 'recipient@example.com'}</span>
          </div>
          {config.subject && (
            <div className="text-ink-muted truncate text-[11px]">
              Sub: {config.subject}
            </div>
          )}
        </div>
      );
      break;

    case 'crmMutateNode':
      Icon = Database;
      category = 'CRM';
      defaultTitle = 'CRM Mutation';
      iconBg = 'bg-brand-soft';
      iconColor = 'text-ink';
      previewContent = (
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="rounded bg-brand-soft px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink uppercase tracking-tight">
            {config.action || 'CREATE_CONTACT'}
          </span>
          <span className="text-ink-muted truncate">CRM Entity</span>
        </div>
      );
      break;

    default:
      previewContent = <div className="text-[11px] text-ink-muted truncate">Generic Action</div>;
      break;
  }

  const title = plainStepName(type, nodeData.label) || defaultTitle;
  // Every action reads the same on the canvas: it does something.
  category = stepWording(type)?.kind ?? category;

  return (
    <BaseNode
      icon={Icon}
      title={title}
      category={category}
      status={status}
      selected={selected}
      hasInput={true}
      hasOutput={true}
      iconBg={iconBg}
      iconColor={iconColor}
      testId={`action-node-${type}`}
    >
      <div className="rounded-md bg-surface-muted p-1.5 border border-border/40">
        {previewContent}
      </div>
    </BaseNode>
  );
}
