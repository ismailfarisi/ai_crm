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

/** What the AI would do with a customer message, worked out without sending or saving anything. */
export const testChannelAiSchema = z.object({
  body: z.string().trim().min(1, 'Type a message to try').max(2000),
  provider: z.enum(['WHATSAPP_META', 'TELEGRAM', 'SLACK', 'EMAIL_SMTP', 'EMAIL_RESEND']),
});
export type TestChannelAiPayload = z.infer<typeof testChannelAiSchema>;

export type ChannelAiTestOutcome =
  /** An automatic reply rule would run. */
  | 'RULE'
  /** The AI would ask the customer a question and wait. */
  | 'ASK'
  /** The conversation would go to a person. */
  | 'HANDOVER'
  /** The AI could not read the message: no provider, no model, or over budget. */
  | 'UNAVAILABLE';

export interface ChannelAiTestResultDto {
  outcome: ChannelAiTestOutcome;
  intent: string | null;
  confidence: number | null;
  summary: string | null;
  /** The rule that would run, for RULE. */
  rule: { name: string; actionType: string; reply: string | null } | null;
  /** The question the AI would ask, for ASK. */
  question: string | null;
  /** Why a person would get it, for HANDOVER. */
  handoverReason: ChannelHandoverReason | null;
  /** True when a rule runs and the conversation is still handed to a person afterwards (a complaint). */
  thenHandover: boolean;
}
