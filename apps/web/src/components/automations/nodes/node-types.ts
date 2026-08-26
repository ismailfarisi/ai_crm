import type { NodeTypes } from '@xyflow/react';
import type { AutomationNodeType } from '@saas/shared';
import { BaseNode } from './base-node';
import { TriggerNode } from './trigger-node';
import { ConditionNode } from './condition-node';
import { ApprovalNode } from './approval-node';
import { ActionNode } from './action-node';
import { DelayNode } from './delay-node';
import { TransformNode } from './transform-node';

export const NODE_TYPES: Record<AutomationNodeType, any> = {
  webhookTrigger: TriggerNode,
  scheduleTrigger: TriggerNode,
  crmEventTrigger: TriggerNode,
  manualTrigger: TriggerNode,
  conditionNode: ConditionNode,
  transformNode: TransformNode,
  delayNode: DelayNode,
  httpRequestNode: ActionNode,
  aiPromptNode: ActionNode,
  sendEmailNode: ActionNode,
  crmMutateNode: ActionNode,
  approvalNode: ApprovalNode,
};

export {
  BaseNode,
  TriggerNode,
  ConditionNode,
  ApprovalNode,
  ActionNode,
  DelayNode,
  TransformNode,
};
