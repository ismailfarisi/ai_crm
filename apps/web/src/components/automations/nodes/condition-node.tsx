'use client';

import React from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Split } from 'lucide-react';
import type { AutomationNodeData } from '@saas/shared';
import { BaseNode } from './base-node';
import { AddStepButton } from './add-step-button';
import { describeCondition, readCondition } from '../condition-rules';
import { plainStepName } from '../step-wording';

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
  const read = readCondition(config);
  // The rules in plain words; a condition written by hand is shown as written.
  const conditionExpression =
    (read.mode === 'builder' ? describeCondition(read.state) : read.expression) || 'No rule set yet';

  return (
    <BaseNode
      icon={Split}
      title={plainStepName('conditionNode', nodeData.label)}
      category="Decide or wait"
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
          className="rounded-md bg-surface-muted px-2 py-1.5 border border-border/80 text-[11px] text-ink line-clamp-2"
        >
          {conditionExpression}
        </div>

        {/* Dual Branch Output Ports */}
        <div className="space-y-1.5 pt-0.5">
          {/* True Branch */}
          <div className="relative flex items-center justify-between rounded-lg bg-success-soft/60 px-2.5 py-1 border border-success/20">
            <span className="text-[11px] font-semibold text-success">
              Yes
            </span>
            <div className="relative flex items-center">
              <span className="text-[11px] font-medium text-success mr-2">then</span>
              <Handle
                type="source"
                position={Position.Right}
                id="true"
                className="!w-3 !h-3 !bg-success !border-2 !border-surface transition !right-[-16px]"
              />
              <AddStepButton handle="true" outputName="Yes" className="right-[-48px]" />
            </div>
          </div>

          {/* False Branch */}
          <div className="relative flex items-center justify-between rounded-lg bg-surface-muted/60 px-2.5 py-1 border border-border/60">
            <span className="text-[11px] font-semibold text-ink-muted">
              No
            </span>
            <div className="relative flex items-center">
              <span className="text-[11px] font-medium text-ink-muted mr-2">otherwise</span>
              <Handle
                type="source"
                position={Position.Right}
                id="false"
                className="!w-3 !h-3 !bg-border-strong !border-2 !border-surface transition !right-[-16px]"
              />
              <AddStepButton handle="false" outputName="No" className="right-[-48px]" />
            </div>
          </div>
        </div>
      </div>
    </BaseNode>
  );
}
