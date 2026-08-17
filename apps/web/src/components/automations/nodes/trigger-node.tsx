'use client';

import React from 'react';
import { Webhook, Calendar, Zap, Play } from 'lucide-react';
import type { NodeProps, Node } from '@xyflow/react';
import type { AutomationNodeData, AutomationNodeType } from '@saas/shared';
import { BaseNode } from './base-node';

export interface TriggerNodeData extends AutomationNodeData {
  config: {
    slug?: string;
    cron?: string;
    eventType?: string;
    [key: string]: any;
  };
}

export function TriggerNode({
  type = 'manualTrigger',
  data,
  selected,
}: Partial<NodeProps<Node<TriggerNodeData>>> & { type?: AutomationNodeType; data?: Partial<TriggerNodeData>; selected?: boolean }) {
  const nodeData = data || { label: 'Trigger', config: {} };
  const config = nodeData.config || {};
  const status = (nodeData as any).status || (nodeData as any).executionStatus;

  let Icon = Play;
  let defaultTitle = 'Manual Trigger';
  let iconBg = 'bg-purple-50';
  let iconColor = 'text-purple-700';
  let previewText = 'Manual Execution';

  switch (type) {
    case 'webhookTrigger':
      Icon = Webhook;
      defaultTitle = 'Webhook Trigger';
      iconBg = 'bg-amber-50';
      iconColor = 'text-amber-700';
      previewText = config.slug ? `/webhooks/${config.slug}` : 'POST /webhooks/...';
      break;

    case 'scheduleTrigger':
      Icon = Calendar;
      defaultTitle = 'Schedule Trigger';
      iconBg = 'bg-blue-50';
      iconColor = 'text-blue-700';
      previewText = config.cron ? `Cron: ${config.cron}` : 'Recurring Schedule (e.g. 0 9 * * 1-5)';
      break;

    case 'crmEventTrigger':
      Icon = Zap;
      defaultTitle = 'CRM Event Trigger';
      iconBg = 'bg-emerald-50';
      iconColor = 'text-emerald-700';
      previewText = config.eventType ? `Event: ${config.eventType}` : 'On CRM Event';
      break;

    case 'manualTrigger':
    default:
      Icon = Play;
      defaultTitle = 'Manual Trigger';
      iconBg = 'bg-purple-50';
      iconColor = 'text-purple-700';
      previewText = 'Manual execution from UI or API';
      break;
  }

  const title = nodeData.label || defaultTitle;

  return (
    <BaseNode
      icon={Icon}
      title={title}
      category="Trigger"
      status={status}
      selected={selected}
      hasInput={false}
      hasOutput={true}
      iconBg={iconBg}
      iconColor={iconColor}
      testId={`trigger-node-${type}`}
    >
      <div className="flex items-center justify-between text-[11px] text-stone-600 font-mono bg-stone-50 px-2 py-1 rounded border border-stone-100 truncate">
        <span className="truncate">{previewText}</span>
      </div>
    </BaseNode>
  );
}
