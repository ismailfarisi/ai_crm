import { z } from 'zod';

/**
 * The in-app assistant's contract. One turn = one agentReActWorkflow run;
 * `assistant_messages` rows are both the transcript and the stream's event log.
 */
export const ASSISTANT_TURN_STATUSES = [
  'RUNNING',
  'AWAITING_APPROVAL',
  'COMPLETED',
  'REJECTED',
  'TIMED_OUT',
  'FAILED',
  'CANCELLED',
] as const;
export type AssistantTurnStatus = (typeof ASSISTANT_TURN_STATUSES)[number];

/** A conversation may have at most one turn in these states (enforced by a partial unique index). */
export const ACTIVE_ASSISTANT_TURN_STATUSES = ['RUNNING', 'AWAITING_APPROVAL'] as const satisfies readonly AssistantTurnStatus[];

export const ASSISTANT_MESSAGE_ROLES = [
  'user',
  'assistant',
  'step',
  'tool_call',
  'tool_result',
  'approval',
  'status',
] as const;
export type AssistantMessageRole = (typeof ASSISTANT_MESSAGE_ROLES)[number];

export const assistantPageContextSchema = z.object({
  entity: z.string().trim().min(1).max(50),
  id: z.string().trim().min(1).max(100),
  label: z.string().trim().max(120).optional(),
});
export type AssistantPageContext = z.output<typeof assistantPageContextSchema>;

export const createAssistantConversationSchema = z.object({
  context: assistantPageContextSchema.nullish(),
});
export type CreateAssistantConversationPayload = z.output<typeof createAssistantConversationSchema>;

export const updateAssistantConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => v.title !== undefined || v.archived !== undefined, {
    message: 'Nothing to update',
  });
export type UpdateAssistantConversationPayload = z.output<typeof updateAssistantConversationSchema>;

export const sendAssistantMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  context: assistantPageContextSchema.nullish(),
});
export type SendAssistantMessagePayload = z.output<typeof sendAssistantMessageSchema>;

/**
 * A decision is bound to one tool call: `toolCallId` must equal the pending
 * action's `tool.id`, so an approval can only ever release the exact action
 * the user was shown.
 */
export const assistantApprovalSchema = z.object({
  approved: z.boolean(),
  toolCallId: z.string().min(1).max(200),
  note: z.string().trim().max(500).optional(),
});
export type AssistantApprovalPayload = z.output<typeof assistantApprovalSchema>;

export interface AssistantPendingAction {
  tool: { id: string; name: string; args: Record<string, unknown> };
  preview: Record<string, unknown>;
}

export interface AssistantTurnDto {
  id: string;
  conversationId: string;
  status: AssistantTurnStatus;
  pendingAction: AssistantPendingAction | null;
  steps: number;
  model: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface AssistantMessageDto {
  id: string;
  conversationId: string;
  turnId: string | null;
  /** Monotonic within a conversation; the SSE event id. */
  seq: number;
  role: AssistantMessageRole;
  content: string;
  toolName: string | null;
  /** For `status` rows: `{ turn: AssistantTurnDto }`. For `approval`: `AssistantPendingAction`. */
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface AssistantConversationDto {
  id: string;
  title: string;
  context: AssistantPageContext | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface AssistantConversationDetailDto extends AssistantConversationDto {
  messages: AssistantMessageDto[];
  activeTurn: AssistantTurnDto | null;
}
