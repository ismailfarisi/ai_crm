'use client';

import React from 'react';
import { Timer } from 'lucide-react';
import type { NodeProps, Node } from '@xyflow/react';
import type { AutomationNodeData } from '@saas/shared';
import { BaseNode } from './base-node';

export interface DelayNodeData extends AutomationNodeData {
  config: {
    delayMinutes?: number;
    duration?: string;
    [key: string]: any;
  };
}

export function DelayNode({
  data,
  selected,
}: Partial<NodeProps<Node<DelayNodeData>>> & { data?: Partial<DelayNodeData>; selected?: boolean }) {
  const nodeData = data || { label: 'Delay Execution', config: {} };
  const config = nodeData.config || {};
  const status = (nodeData as any).status || (nodeData as any).executionStatus;
  const delayMinutes = config.delayMinutes ?? 5;
  // The worker reads durationMs, then duration, then delay; show the same one.
  const set = [config.durationMs, config.duration, config.delay].find(
    (value) => value != null && String(value).trim() !== '',
  );
  const displayText =
    set == null
      ? `${delayMinutes} minute${delayMinutes === 1 ? '' : 's'}`
      : /^\s*\d+(\.\d+)?\s*$/.test(String(set))
        ? `${Number(set)} ms`
        : String(set);

  return (
    <BaseNode
      icon={Timer}
      title={nodeData.label || 'Delay Execution'}
      category="Logic"
      status={status}
      selected={selected}
      hasInput={true}
      hasOutput={true}
      iconBg="bg-brand-soft"
      iconColor="text-ink"
      testId="delay-node"
    >
      <div className="flex items-center justify-between rounded-md bg-surface-muted px-2.5 py-1.5 border border-border/40 text-[11px] text-ink-muted">
        <span className="text-ink-muted font-medium">Wait Duration:</span>
        <span className="font-mono font-semibold text-ink bg-surface px-1.5 py-0.5 rounded border border-border">
          {displayText}
        </span>
      </div>
    </BaseNode>
  );
}
