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
  const displayText = config.duration || `${delayMinutes} minute${delayMinutes === 1 ? '' : 's'}`;

  return (
    <BaseNode
      icon={Timer}
      title={nodeData.label || 'Delay Execution'}
      category="Logic"
      status={status}
      selected={selected}
      hasInput={true}
      hasOutput={true}
      iconBg="bg-amber-50"
      iconColor="text-amber-700"
      testId="delay-node"
    >
      <div className="flex items-center justify-between rounded-md bg-stone-50 px-2.5 py-1.5 border border-stone-100 text-[11px] text-stone-600">
        <span className="text-stone-500 font-medium">Wait Duration:</span>
        <span className="font-mono font-semibold text-stone-800 bg-white px-1.5 py-0.5 rounded border border-stone-200">
          {displayText}
        </span>
      </div>
    </BaseNode>
  );
}
