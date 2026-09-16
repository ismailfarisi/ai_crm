'use client';

import React from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Split } from 'lucide-react';
import type { AutomationNodeData } from '@saas/shared';
import { BaseNode } from './base-node';

export interface ConditionNodeData extends AutomationNodeData {
  config: {
    condition?: string;
    [key: string]: any;
  };
}

export function ConditionNode({
  data,
  selected,
}: Partial<NodeProps<Node<ConditionNodeData>>> & { data?: Partial<ConditionNodeData>; selected?: boolean }) {
  const nodeData = data || { label: 'Condition Branch', config: {} };
  const config = nodeData.config || {};
  const status = (nodeData as any).status || (nodeData as any).executionStatus;
  const conditionExpression = config.condition ? String(config.condition) : 'No condition set';

  return (
    <BaseNode
      icon={Split}
      title={nodeData.label || 'Condition Branch'}
      category="Logic"
      status={status}
      selected={selected}
      hasInput={true}
      hasOutput={false}
      iconBg="bg-info-soft"
      iconColor="text-info"
      testId="condition-node"
    >
      <div className="space-y-2.5">
        {/* Condition expression display */}
        <div
          title={conditionExpression}
          className="rounded-md bg-surface-muted px-2 py-1.5 border border-border/80 font-mono text-[11px] text-ink truncate"
        >
          {conditionExpression}
        </div>

        {/* Dual Branch Output Ports */}
        <div className="space-y-1.5 pt-0.5">
          {/* True Branch */}
          <div className="relative flex items-center justify-between rounded-lg bg-success-soft/60 px-2.5 py-1 border border-success/20">
            <span className="text-[10px] font-bold uppercase tracking-wider text-success">
              True
            </span>
            <div className="relative flex items-center">
              <span className="text-[9px] font-medium text-success mr-2">Then</span>
              <Handle
                type="source"
                position={Position.Right}
                id="true"
                className="!w-3 !h-3 !bg-success !border-2 !border-surface transition-all hover:scale-125 !right-[-16px]"
              />
            </div>
          </div>

          {/* False Branch */}
          <div className="relative flex items-center justify-between rounded-lg bg-surface-muted/60 px-2.5 py-1 border border-border/60">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
              False
            </span>
            <div className="relative flex items-center">
              <span className="text-[9px] font-medium text-ink-muted mr-2">Else</span>
              <Handle
                type="source"
                position={Position.Right}
                id="false"
                className="!w-3 !h-3 !bg-border-strong !border-2 !border-surface transition-all hover:scale-125 !right-[-16px]"
              />
            </div>
          </div>
        </div>
      </div>
    </BaseNode>
  );
}
