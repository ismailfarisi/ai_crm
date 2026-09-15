/**
 * Shared vocabulary for the staff chat command layer.
 *
 * Kept in `shared` because the web app needs the same names to render a
 * conversation's state on the channels screen, and because the skill names
 * are a stable contract that eval fixtures assert against.
 */

/**
 * Where a chat conversation is.
 *
 * `COLLECTING` is the state the old single-turn design had nowhere to put:
 * the skill is known but its slots are not all filled yet, so the next
 * message is an answer to `pendingQuestion` rather than a new command.
 */
export type ChannelConversationStatus =
  | 'COLLECTING'
  | 'AWAITING_CONFIRM'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'EXPIRED';

/** What a completed skill produced, so the conversation can refer back to it. */
export type ChannelResultType = 'QUOTE' | 'INVOICE' | 'PURCHASE_ORDER' | 'WORK_ORDER';

/**
 * The registered skills, as a closed union.
 *
 * A skill name is a contract: it appears in eval fixtures, in the audit trail
 * and in `channel_conversations.skill_name` rows that outlive a deploy.
 * Renaming one is a migration, not a refactor.
 */
export const CHANNEL_SKILLS = {
  QUOTE_APPROVE: 'quote.approve',
  PURCHASE_ORDER_CREATE: 'purchase_order.create',
  WORK_ORDER_LOG_TIME: 'work_order.log_time',
} as const;

export type ChannelSkillName = (typeof CHANNEL_SKILLS)[keyof typeof CHANNEL_SKILLS];

/**
 * The router's verdict. Deliberately not just a skill name: a confident
 * "I don't know" has to be distinguishable from a low-confidence guess,
 * because only one of those is safe to act on.
 */
export interface SkillRoute {
  skill: ChannelSkillName | null;
  confidence: number;
  /** Populated when two skills scored closely, so the reply can offer both. */
  alternatives?: ChannelSkillName[];
}

/**
 * Below this the router's answer is treated as a suggestion to confirm, never
 * as a decision. A wrong guess that reaches the confirmation step is a wrong
 * purchase order one "yes" away from existing.
 */
export const SKILL_ROUTE_MIN_CONFIDENCE = 0.6;

/** How long a half-finished conversation stays resumable. */
export const CHANNEL_CONVERSATION_TTL_MS = 15 * 60 * 1000;

/**
 * The outcome of running a skill, in the shape the transport needs: a line of
 * text to send back, plus optional state for the conversation row.
 */
export interface SkillOutcome {
  reply: string;
  resultType?: ChannelResultType;
  resultId?: string;
}

/**
 * What `resolve` hands back. Three cases, because collapsing "ambiguous" into
 * "not found" is how a system ends up silently picking the wrong supplier.
 */
export type SkillResolution<T> =
  | { kind: 'resolved'; value: T }
  | { kind: 'question'; question: string; slots: Record<string, unknown> }
  | { kind: 'refused'; reason: string };
