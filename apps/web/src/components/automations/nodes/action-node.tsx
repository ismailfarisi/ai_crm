'use client';

import React from 'react';
import { Globe, Sparkles, Mail, Database } from 'lucide-react';
import type { NodeProps, Node } from '@xyflow/react';
import type { AutomationNodeData, AutomationNodeType } from '@saas/shared';
import { BaseNode } from './base-node';

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
  let iconBg = 'bg-stone-100';
  let iconColor = 'text-stone-700';

  let previewContent: React.ReactNode = null;

  switch (type) {
    case 'httpRequestNode':
      Icon = Globe;
      category = 'HTTP';
      defaultTitle = 'HTTP Request';
      iconBg = 'bg-sky-50';
      iconColor = 'text-sky-700';
      previewContent = (
        <div className="flex items-center gap-1.5 font-mono text-[11px] truncate">
          <span className="rounded bg-sky-100 px-1 py-0.5 font-bold text-sky-800 text-[10px]">
            {config.method || 'GET'}
          </span>
          <span className="text-stone-600 truncate">{config.url || 'https://api.example.com'}</span>
        </div>
      );
      break;

    case 'aiPromptNode':
      Icon = Sparkles;
      category = 'AI';
      defaultTitle = 'AI Prompt / LLM';
      iconBg = 'bg-violet-50';
      iconColor = 'text-violet-700';
      previewContent = (
        <div className="space-y-1 text-[11px]">
          <div className="flex items-center justify-between text-stone-500">
            <span>Model:</span>
            <span className="font-mono text-[10px] font-semibold text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded border border-violet-200/50">
              {config.model || 'gpt-4o-mini'}
            </span>
          </div>
          <p className="text-stone-600 italic truncate font-sans text-[11px]">
            {config.prompt ? `"${config.prompt}"` : 'Generate completion...'}
          </p>
        </div>
      );
      break;

    case 'sendEmailNode':
      Icon = Mail;
      category = 'Email';
      defaultTitle = 'Send Email';
      iconBg = 'bg-rose-50';
      iconColor = 'text-rose-700';
      previewContent = (
        <div className="space-y-0.5 text-[11px] truncate">
          <div className="text-stone-700 font-medium truncate">
            To: <span className="text-stone-500">{config.to || 'recipient@example.com'}</span>
          </div>
          {config.subject && (
            <div className="text-stone-500 truncate text-[10px]">
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
      iconBg = 'bg-amber-50';
      iconColor = 'text-amber-700';
      previewContent = (
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-800 uppercase tracking-tight">
            {config.action || 'CREATE_CONTACT'}
          </span>
          <span className="text-stone-500 truncate">CRM Entity</span>
        </div>
      );
      break;

    default:
      previewContent = <div className="text-[11px] text-stone-500 truncate">Generic Action</div>;
      break;
  }

  const title = nodeData.label || defaultTitle;

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
      <div className="rounded-md bg-stone-50 p-1.5 border border-stone-100">
        {previewContent}
      </div>
    </BaseNode>
  );
}
