export const AUTOMATION_PERMISSIONS = {
  AUTOMATION_READ: 'automation:read',
  AUTOMATION_CREATE: 'automation:create',
  AUTOMATION_UPDATE: 'automation:update',
  AUTOMATION_DELETE: 'automation:delete',
  AUTOMATION_EXECUTE: 'automation:execute',
  AUTOMATION_APPROVE: 'automation:approve',
} as const;

export type AutomationPermission = (typeof AUTOMATION_PERMISSIONS)[keyof typeof AUTOMATION_PERMISSIONS];

export type AutomationTriggerType = 'WEBHOOK' | 'SCHEDULE' | 'CRM_EVENT' | 'MANUAL';

export type AutomationNodeType =
  | 'webhookTrigger'
  | 'scheduleTrigger'
  | 'crmEventTrigger'
  | 'manualTrigger'
  | 'conditionNode'
  | 'transformNode'
  | 'delayNode'
  | 'httpRequestNode'
  | 'aiPromptNode'
  | 'sendEmailNode'
  | 'crmMutateNode'
  | 'approvalNode';

export interface AutomationNodeData extends Record<string, any> {
  label: string;
  config: Record<string, any>;
  continueOnFail?: boolean;
  retryCount?: number;
  timeoutDuration?: string; // e.g. '3 days' for approval timeouts
}

export interface AutomationNode {
  id: string;
  type: AutomationNodeType;
  position: { x: number; y: number };
  data: AutomationNodeData;
}

export interface AutomationEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null; // e.g. 'true' | 'false' | 'approved' | 'rejected' | 'timeout'
  targetHandle?: string | null;
}

export interface AutomationWorkflowDto {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED';
  triggerType: AutomationTriggerType;
  triggerConfig: Record<string, any>;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  webhookSlug?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationExecutionDto {
  id: string;
  tenantId: string;
  workflowId: string;
  temporalWorkflowId: string;
  status: 'RUNNING' | 'WAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  triggerPayload: Record<string, any>;
  nodeResults: Record<
    string,
    {
      status: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'WAITING';
      input?: any;
      output?: any;
      error?: string;
      startedAt: string;
      finishedAt?: string;
      durationMs?: number;
    }
  >;
  startedAt: string;
  finishedAt?: string | null;
  errorMessage?: string | null;
}

export interface CreateAutomationWorkflowPayload {
  name: string;
  description?: string | null;
  triggerType: AutomationTriggerType;
  triggerConfig?: Record<string, any>;
  nodes?: AutomationNode[];
  edges?: AutomationEdge[];
}

export interface UpdateAutomationWorkflowPayload {
  name?: string;
  description?: string | null;
  status?: 'DRAFT' | 'ACTIVE' | 'PAUSED';
  triggerType?: AutomationTriggerType;
  triggerConfig?: Record<string, any>;
  nodes?: AutomationNode[];
  edges?: AutomationEdge[];
}

export interface SignalAutomationExecutionPayload {
  action: 'APPROVE' | 'REJECT';
  nodeId: string;
  reason?: string;
  comment?: string;
}

export function validateWorkflowGraph(
  nodes: AutomationNode[],
  edges: AutomationEdge[],
): { isValid: boolean; triggerNodeId?: string; error?: string } {
  if (!nodes || nodes.length === 0) {
    return { isValid: false, error: 'Workflow must have at least one Trigger node' };
  }

  const triggerNodes = nodes.filter((n) =>
    ['webhookTrigger', 'scheduleTrigger', 'crmEventTrigger', 'manualTrigger'].includes(n.type),
  );

  if (triggerNodes.length === 0) {
    return { isValid: false, error: 'Workflow must have at least one Trigger node' };
  }

  return { isValid: true, triggerNodeId: triggerNodes[0].id };
}
