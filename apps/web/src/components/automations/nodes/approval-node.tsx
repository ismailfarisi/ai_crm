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
      iconBg="bg-amber-50"
      iconColor="text-amber-800"
      testId="approval-node"
    >
      <div className="space-y-2.5">
        {/* Approver role and timeout info */}
        <div className="rounded-md bg-stone-50 p-2 border border-stone-200/80 text-[11px] text-stone-600 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-stone-500">Approver:</span>
            <span className="font-semibold text-stone-800 capitalize">{approverRole}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-stone-500">Timeout:</span>
            <span className="font-semibold text-stone-800">{timeoutDuration}</span>
          </div>
        </div>

        {/* 3-Way Output Handles */}
        <div className="space-y-1.5 pt-0.5">
          {/* Approved */}
          <div className="relative flex items-center justify-between rounded-lg bg-emerald-50/60 px-2.5 py-1 border border-emerald-200/60">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
              Approved
            </span>
            <div className="relative flex items-center">
              <span className="text-[9px] font-medium text-emerald-600 mr-2">Passed</span>
              <Handle
                type="source"
                position={Position.Right}
                id="approved"
                className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-white transition-all hover:scale-125 !right-[-16px]"
              />
            </div>
          </div>

          {/* Rejected */}
          <div className="relative flex items-center justify-between rounded-lg bg-rose-50/60 px-2.5 py-1 border border-rose-200/60">
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700">
              Rejected
            </span>
            <div className="relative flex items-center">
              <span className="text-[9px] font-medium text-rose-500 mr-2">Denied</span>
              <Handle
                type="source"
                position={Position.Right}
                id="rejected"
                className="!w-3 !h-3 !bg-rose-500 !border-2 !border-white transition-all hover:scale-125 !right-[-16px]"
              />
            </div>
          </div>

          {/* Timeout */}
          <div className="relative flex items-center justify-between rounded-lg bg-amber-50/60 px-2.5 py-1 border border-amber-200/60">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
              Timeout
            </span>
            <div className="relative flex items-center">
              <span className="text-[9px] font-medium text-amber-600 mr-2">Expired</span>
              <Handle
                type="source"
                position={Position.Right}
                id="timeout"
                className="!w-3 !h-3 !bg-amber-500 !border-2 !border-white transition-all hover:scale-125 !right-[-16px]"
              />
            </div>
          </div>
        </div>
      </div>
    </BaseNode>
  );
}
