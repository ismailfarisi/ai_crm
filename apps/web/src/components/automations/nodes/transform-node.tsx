'use client';

import React from 'react';
import { Code2 } from 'lucide-react';
import type { NodeProps, Node } from '@xyflow/react';
import type { AutomationNodeData } from '@saas/shared';
import { BaseNode } from './base-node';

export interface TransformNodeData extends AutomationNodeData {
  config: {
    script?: string;
    [key: string]: any;
  };
}

export function TransformNode({
  data,
  selected,
}: Partial<NodeProps<Node<TransformNodeData>>> & { data?: Partial<TransformNodeData>; selected?: boolean }) {
  const nodeData = data || { label: 'Data Transform', config: {} };
  const config = nodeData.config || {};
  const status = (nodeData as any).status || (nodeData as any).executionStatus;
  const scriptSnippet = config.script?.trim() || 'return payload;';

  return (
    <BaseNode
      icon={Code2}
      title={nodeData.label || 'Data Transform'}
      category="Transform"
      status={status}
      selected={selected}
      hasInput={true}
      hasOutput={true}
      iconBg="bg-success-soft"
      iconColor="text-success"
      testId="transform-node"
    >
      <div className="rounded-md bg-brand-dark px-2.5 py-1.5 font-mono text-[11px] text-success truncate shadow-inner">
        <span className="text-ink-muted mr-1.5 select-none">$</span>
        <span className="truncate">{scriptSnippet}</span>
      </div>
    </BaseNode>
  );
}
