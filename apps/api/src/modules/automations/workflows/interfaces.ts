import { defineQuery, defineSignal } from '@temporalio/workflow';
import type { AutomationEdge, AutomationNode } from '@saas/shared';

export interface DynamicWorkflowInput {
  executionId: string;
  workflowId: string;
  tenantId: string;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  triggerPayload: Record<string, any>;
  triggerNodeId?: string;
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

export const approveNodeSignal = defineSignal<[NodeApprovalSignalPayload | string]>('approveNode');
export const rejectNodeSignal = defineSignal<[NodeRejectionSignalPayload | string]>('rejectNode');
export const getExecutionStateQuery = defineQuery<WorkflowExecutionState>('getExecutionState');

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

export interface AiPromptActivityConfig {
  prompt: string;
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  mockResponse?: string;
  tenantId?: string;
}

export interface AiPromptActivityResult {
  text: string;
  completion?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface EmailActivityConfig {
  to: string | string[];
  subject: string;
  body?: string;
  html?: string;
  from?: string;
  cc?: string[];
  bcc?: string[];
}

export interface EmailActivityResult {
  success: boolean;
  messageId: string;
  to: string | string[];
  sentAt: string;
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
  entity: 'contact' | 'quote' | 'invoice' | 'deal' | string;
  action: 'create' | 'update' | 'delete' | 'upsert';
  data: Record<string, any>;
  recordId?: string;
  tenantId?: string;
}

export interface CrmMutationActivityResult {
  success: boolean;
  entity: string;
  action: string;
  recordId: string;
  data: any;
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
