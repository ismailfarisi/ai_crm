import type {
  AssistantMessageRole,
  AssistantPendingAction,
  AssistantTurnStatus,
  AuditChannel,
} from '@saas/shared';

export interface ToolAuditProvenance {
  channel: AuditChannel;
  messageId?: string;
}

export interface AgentActivityCtx {
  organizationId: string;
  userId: string;
  message: string;
  audit?: ToolAuditProvenance;
}

export interface AssistantEventInput {
  organizationId: string;
  conversationId: string;
  turnId: string;
  /** Deterministic per workflow step; (turnId, eventKey) is unique so retries are no-ops. */
  eventKey: string;
  role: Exclude<AssistantMessageRole, 'user'>;
  content: string;
  toolName?: string;
  payload?: Record<string, unknown>;
  /** When set, the turn row is updated in the same transaction and a `status` row is also written. */
  turn?: {
    status?: AssistantTurnStatus;
    pendingAction?: AssistantPendingAction | null;
    steps?: number;
    model?: string;
    error?: string;
  };
}

export interface ToolCallSpec {
  id: string;
  name: string;
  args: Record<string, unknown>;
  model?: string;
}

export interface ToolExecutionResult {
  toolCallId: string;
  toolName: string;
  isMutating: boolean;
  requiresApproval: boolean;
  previewPayload?: Record<string, unknown>;
  output?: Record<string, unknown>;
  errorMessage?: string;
}

export interface ReActTurnInput {
  organizationId: string;
  userId: string;
  prompt: string;
  conversationHistory: Array<{ role: 'user' | 'assistant' | 'tool'; content: string }>;
  availableTools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
}

export interface ReActTurnOutput {
  thought: string;
  toolCalls?: ToolCallSpec[];
  finalAnswer?: string;
  model?: string;
}

export interface AgentReactActivities {
  listAvailableTools(input: {
    organizationId: string;
    userId: string;
    allowedDomains?: string[];
  }): Promise<Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>>;
  planReActTurn(input: ReActTurnInput): Promise<ReActTurnOutput>;
  executeToolActivity(
    tool: ToolCallSpec,
    ctx: AgentActivityCtx,
  ): Promise<ToolExecutionResult>;
  commitToolMutationActivity(
    tool: ToolCallSpec,
    ctx: AgentActivityCtx,
  ): Promise<{ success: boolean; resultSummary: string }>;
  /** Registered only on assistant-queue; called only when the workflow has an eventSink. */
  emitAssistantEventActivity(input: AssistantEventInput): Promise<void>;
}
