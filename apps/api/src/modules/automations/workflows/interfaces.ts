import { defineQuery, defineSignal } from '@temporalio/workflow';
import type {
  AutomationEdge,
  AutomationNode,
  AutomationTriggerType,
} from '@saas/shared';

export interface DynamicWorkflowInput {
  executionId: string;
  workflowId: string;
  tenantId: string;
  actorUserId?: string;
  ownerUserId?: string;
  workflowName?: string;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  triggerPayload: Record<string, any>;
  triggerNodeId?: string;
  /**
   * How this run was triggered, set by AutomationsService from the
   * automation (never read from the payload). Webhook runs never
   * auto-approve agent tools.
   */
  triggerType?: AutomationTriggerType;
}

export interface NodeExecutionResult {
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'WAITING';
  input?: any;
  output?: any;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface PendingApprovalState {
  nodeId: string;
  nodeLabel: string;
  requestedAt: string;
  timeoutDuration?: string;
  context?: any;
}

export interface WorkflowExecutionState {
  executionId: string;
  workflowId: string;
  tenantId: string;
  status: 'RUNNING' | 'WAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  currentNodeId?: string | null;
  nodeResults: Record<string, NodeExecutionResult>;
  pendingApprovals: Record<string, PendingApprovalState>;
  startedAt: string;
  finishedAt?: string | null;
  errorMessage?: string | null;
}

export interface NodeApprovalSignalPayload {
  nodeId: string;
  approvedBy?: string;
  comment?: string;
}

export interface NodeRejectionSignalPayload {
  nodeId: string;
  rejectedBy?: string;
  reason?: string;
}

export const approveNodeSignal =
  defineSignal<[NodeApprovalSignalPayload | string]>('approveNode');
export const rejectNodeSignal =
  defineSignal<[NodeRejectionSignalPayload | string]>('rejectNode');
export const getExecutionStateQuery =
  defineQuery<WorkflowExecutionState>('getExecutionState');

// Activity config & return interfaces
export interface HttpActivityConfig {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, any>;
  body?: any;
  timeout?: number;
}

export interface HttpActivityResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: any;
}

/** What an action activity needs to know about the step it is running for. */
export interface AutomationActionContext {
  tenantId: string;
  workflowId: string;
  workflowName: string;
  executionId: string;
  nodeId: string;
  ownerUserId?: string;
  /** True when the step's text was written by an upstream AI step. */
  aiWritten: boolean;
}

export interface AiPromptActivityConfig {
  prompt: string;
}

export interface AiPromptActivityResult {
  text: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface EmailActivityConfig {
  to: string;
  subject: string;
  body: string;
}

export interface EmailActivityResult {
  sent: string[];
  provider: string;
}

export interface CodeTransformActivityConfig {
  code: string;
  input?: any;
  context?: Record<string, any>;
}

export interface CodeTransformActivityResult {
  output: any;
}

export interface CrmMutationActivityConfig {
  entity: 'contact' | 'quote';
  action: 'create' | 'update' | 'approve' | 'reject';
  recordId?: string;
  fields?: Record<string, unknown>;
  reason?: string;
}

export interface CrmMutationActivityResult {
  entity: string;
  action: string;
  recordId: string;
  record: Record<string, unknown>;
}

export interface RecordNodeResultParams {
  executionId: string;
  workflowId?: string;
  tenantId?: string;
  nodeId: string;
  nodeType?: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'WAITING';
  input?: any;
  output?: any;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface RecordNodeResultResult {
  recorded: boolean;
  executionId: string;
  nodeId: string;
}

export type {
  AiAgentNodeConfig,
  AiAgentNodeResult,
  AiAgentDomain,
  AiAgentToolCallRecord,
  AiAgentUsage,
} from '@saas/shared';
