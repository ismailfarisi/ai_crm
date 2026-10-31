'use client';

import React from 'react';
import { Webhook, Calendar, Zap, Play, AlertTriangle } from 'lucide-react';
import type { NodeProps, Node } from '@xyflow/react';
import type { AutomationNodeData, AutomationNodeType } from '@saas/shared';
import { BaseNode } from './base-node';
import { crmEventOf, findCrmEvent } from '../crm-events';

export interface TriggerNodeData extends AutomationNodeData {
  config: {
    slug?: string;
    cron?: string;
    event?: string;
    /** Older builds saved the event here; still read. */
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
  let iconBg = 'bg-info-soft';
  let iconColor = 'text-info';
  let previewText = 'Manual Execution';
  // A stored event this build doesn't know: it may never fire.
  let unknownEvent: string | null = null;

  switch (type) {
    case 'webhookTrigger':
      Icon = Webhook;
      defaultTitle = 'Webhook Trigger';
      iconBg = 'bg-brand-soft';
      iconColor = 'text-ink';
      previewText = config.slug ? `/webhooks/${config.slug}` : 'POST /webhooks/...';
      break;

    case 'scheduleTrigger':
      Icon = Calendar;
      defaultTitle = 'Schedule Trigger';
      iconBg = 'bg-info-soft';
      iconColor = 'text-info';
      previewText = config.cron ? `Cron: ${config.cron}` : 'Recurring Schedule (e.g. 0 9 * * 1-5)';
      break;

    case 'crmEventTrigger':
      Icon = Zap;
      defaultTitle = 'CRM Event Trigger';
      iconBg = 'bg-success-soft';
      iconColor = 'text-success';
      {
        const event = crmEventOf(config);
        const known = findCrmEvent(event);
        if (known) previewText = known.label;
        else if (event) unknownEvent = event;
        else previewText = 'Choose an event';
      }
      break;

    case 'manualTrigger':
    default:
      Icon = Play;
      defaultTitle = 'Manual Trigger';
      iconBg = 'bg-info-soft';
      iconColor = 'text-info';
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
      {unknownEvent ? (
        <div
          data-testid="trigger-unknown-event"
          className="flex items-center gap-1.5 text-[11px] text-warning bg-warning-soft px-2 py-1 rounded border border-warning/20"
        >
          <AlertTriangle aria-hidden className="h-3 w-3 shrink-0" />
          <span className="truncate">Unknown event: {unknownEvent}</span>
        </div>
      ) : (
        <div
          className={`flex items-center justify-between text-[11px] text-ink-muted bg-surface-muted px-2 py-1 rounded border border-border/40 truncate ${
            type === 'crmEventTrigger' ? '' : 'font-mono'
          }`}
        >
          <span className="truncate">{previewText}</span>
        </div>
      )}
    </BaseNode>
  );
}
