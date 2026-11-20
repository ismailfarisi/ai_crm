import { z } from 'zod';

/**
 * Who is answering a customer conversation.
 *
 * AI: the AI replies. NEEDS_HUMAN: the AI stopped and nobody has picked it up.
 * HUMAN: a member of staff is answering and the AI stays quiet. RESOLVED:
 * closed; the customer's next message starts again with the AI.
 */
export const ChannelThreadStateEnum = z.enum(['AI', 'NEEDS_HUMAN', 'HUMAN', 'RESOLVED']);
export type ChannelThreadState = z.infer<typeof ChannelThreadStateEnum>;

/** Why the AI handed a conversation to a person. */
export const ChannelHandoverReasonEnum = z.enum([
  'HUMAN_REQUESTED',
  'COMPLAINT',
  'UNRESOLVED',
  'NO_AGENT',
  'LOW_CONFIDENCE',
  'ERROR',
  'STAFF_REPLIED',
  'STAFF_TOOK_OVER',
]);
export type ChannelHandoverReason = z.infer<typeof ChannelHandoverReasonEnum>;

export const CHANNEL_HANDOVER_REASON_LABELS: Record<ChannelHandoverReason, string> = {
  HUMAN_REQUESTED: 'The customer asked for a person',
  COMPLAINT: 'The customer is complaining',
  UNRESOLVED: 'The AI could not work out what the customer wants',
  NO_AGENT: 'No AI rule covers this request',
  LOW_CONFIDENCE: 'The AI was not sure what the customer wants',
  ERROR: 'The AI failed on this message',
  STAFF_REPLIED: 'A member of staff replied',
  STAFF_TOOK_OVER: 'A member of staff took over',
};

export const DEFAULT_HANDOVER_MESSAGE =
  'Thanks. A member of our team will reply here shortly.';

export interface ChannelThreadDto {
  id: string;
  provider: string;
  contactId: string;
  state: ChannelThreadState;
  assigneeUserId: string | null;
  /** Display name of the assignee, when there is one. */
  assigneeName: string | null;
  handoverReason: ChannelHandoverReason | null;
  /** What the AI understood before it stopped, for whoever picks this up. */
  handoverSummary: string | null;
  handedOverAt: string | null;
  updatedAt: string;
}
