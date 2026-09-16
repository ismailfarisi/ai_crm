'use client';

import React from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { ShieldAlert } from 'lucide-react';
import type { AutomationNodeData } from '@saas/shared';
import { BaseNode } from './base-node';

export interface ApprovalNodeData extends AutomationNodeData {
  config: {
    approverRole?: string;
    timeoutDuration?: string;
    [key: string]: any;
  };
}

export function ApprovalNode({
  data,
  selected,
}: Partial<NodeProps<Node<ApprovalNodeData>>> & { data?: Partial<ApprovalNodeData>; selected?: boolean }) {
  const nodeData = data || { label: 'Human Approval', config: {} };
  const config = nodeData.config || {};
  const status = (nodeData as any).status || (nodeData as any).executionStatus;
  const approverRole = config.approverRole || 'admin';
  const timeoutDuration = config.timeoutDuration || '3 days';

  return (
    <BaseNode
      icon={ShieldAlert}
      title={nodeData.label || 'Human Approval'}
      category="Human-in-the-Loop"
      status={status}
      selected={selected}
      hasInput={true}
      hasOutput={false}
      iconBg="bg-brand-soft"
      iconColor="text-ink"
      testId="approval-node"
    >
      <div className="space-y-2.5">
        {/* Approver role and timeout info */}
        <div className="rounded-md bg-surface-muted p-2 border border-border/80 text-[11px] text-ink-muted space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-ink-muted">Approver:</span>
            <span className="font-semibold text-ink capitalize">{approverRole}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-ink-muted">Timeout:</span>
            <span className="font-semibold text-ink">{timeoutDuration}</span>
          </div>
        </div>

        {/* 3-Way Output Handles */}
        <div className="space-y-1.5 pt-0.5">
          {/* Approved */}
          <div className="relative flex items-center justify-between rounded-lg bg-success-soft/60 px-2.5 py-1 border border-success/20">
            <span className="text-[10px] font-bold uppercase tracking-wider text-success">
              Approved
            </span>
            <div className="relative flex items-center">
              <span className="text-[9px] font-medium text-success mr-2">Passed</span>
              <Handle
                type="source"
                position={Position.Right}
                id="approved"
                className="!w-3 !h-3 !bg-success !border-2 !border-surface transition-all hover:scale-125 !right-[-16px]"
              />
            </div>
          </div>

          {/* Rejected */}
          <div className="relative flex items-center justify-between rounded-lg bg-danger-soft/60 px-2.5 py-1 border border-danger/20">
            <span className="text-[10px] font-bold uppercase tracking-wider text-danger">
              Rejected
            </span>
            <div className="relative flex items-center">
              <span className="text-[9px] font-medium text-danger mr-2">Denied</span>
              <Handle
                type="source"
                position={Position.Right}
                id="rejected"
                className="!w-3 !h-3 !bg-danger !border-2 !border-surface transition-all hover:scale-125 !right-[-16px]"
              />
            </div>
          </div>

          {/* Timeout */}
          <div className="relative flex items-center justify-between rounded-lg bg-brand-soft/60 px-2.5 py-1 border border-brand/30">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink">
              Timeout
            </span>
            <div className="relative flex items-center">
              <span className="text-[9px] font-medium text-brand mr-2">Expired</span>
              <Handle
                type="source"
                position={Position.Right}
                id="timeout"
                className="!w-3 !h-3 !bg-brand !border-2 !border-surface transition-all hover:scale-125 !right-[-16px]"
              />
            </div>
          </div>
        </div>
      </div>
    </BaseNode>
  );
}
