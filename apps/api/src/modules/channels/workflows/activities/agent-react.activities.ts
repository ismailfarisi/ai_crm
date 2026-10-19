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

/**
 * ApplicationFailure type thrown by commitToolMutationActivity when the
 * action no longer matches the preview the user approved.
 */
export const APPROVED_ACTION_CHANGED = 'ApprovedActionChanged';

/** Who is driving the agent. Skills may limit themselves to some surfaces. */
export type AgentSurface = 'assistant' | 'automation';

export interface AgentActivityCtx {
  organizationId: string;
  userId: string;
  message: string;
  audit?: ToolAuditProvenance;
  /** Absent means 'automation'. */
  surface?: AgentSurface;
  /**
   * The preview the user approved (assistant turns only). The commit
   * recomputes it and refuses if the action no longer matches.
   */
  approvedPreview?: Record<string, unknown>;
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
  /** Set by the workflow when `args` came from the skill's `pinArgs`, not the planner. */
  pinned?: boolean;
}

export interface ToolExecutionResult {
  toolCallId: string;
  toolName: string;
  isMutating: boolean;
  requiresApproval: boolean;
  previewPayload?: Record<string, unknown>;
  /**
   * For gated calls: the args the skill resolved to, pinned so the approval
   * card and the commit act on exactly what was previewed.
   */
  resolvedArgs?: Record<string, unknown>;
  output?: Record<string, unknown>;
  errorMessage?: string;
}

/** An assistant turn exactly as the provider returned it (`AiRawAssistantContent`). */
export interface RawAssistantTurn {
  provider: string;
  content: unknown;
}

/**
 * The agent's working history, in the order the model saw it. Every tool
 * call on an assistant entry is answered by a `tool` entry with its id —
 * providers reject a call left without a result.
 */
export type AgentHistoryEntry =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
      /** Replayed verbatim to the same provider, so its thinking blocks survive. */
      raw?: RawAssistantTurn;
    }
  | { role: 'tool'; toolCallId: string; toolName: string; content: string; isError?: boolean };

export interface ReActTurnInput {
  organizationId: string;
  userId: string;
  prompt: string;
  conversationHistory: AgentHistoryEntry[];
  availableTools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
}

export interface ReActTurnOutput {
  thought: string;
  toolCalls?: ToolCallSpec[];
  /** Calls naming a tool that is not on offer; answered with an error, never run. */
  invalidToolCalls?: Array<{ id: string; name: string }>;
  finalAnswer?: string;
  model?: string;
  /** The planner's turn as the provider returned it, to record in history. */
  raw?: RawAssistantTurn;
}

export interface AgentReactActivities {
  listAvailableTools(input: {
    organizationId: string;
    userId: string;
    allowedDomains?: string[];
    /** Absent means 'automation'. */
    surface?: AgentSurface;
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
