import { defineSignal } from '@temporalio/workflow';
import type { ChannelHandoverReason } from '@saas/shared';
import { ChannelProviderType } from '../entities/channel-config.entity';
import { MessageAiIntent } from '../entities/channel-message.entity';
import { ChannelTranscriptTurn } from '../agents/intent-classifier.agent';

export interface ChannelAiWorkflowInput {
  messageId: string;
  organizationId: string;
  contactId: string;
  provider: ChannelProviderType;
  senderIdentifier: string;
  body: string;
  /** The intent agent's model and AI provider; absent or null runs on the organization's defaults. */
  model?: string | null;
  aiProvider?: string | null;
}

export interface ChannelAiWorkflowResult {
  status: 'COMPLETED' | 'SKIPPED' | 'FAILED';
  autoAcked: boolean;
  createdQuoteId?: string;
}

export interface ClassifyMessageParams {
  organizationId: string;
  transcript: ChannelTranscriptTurn[];
  /** Overrides IntentClassifierAgent's built-in system prompt when set — sourced from IntentAgentConfig. */
  systemPromptOverride?: string;
  /** Overrides the organization's default model when set — sourced from IntentAgentConfig. */
  modelOverride?: string;
  /** The AI provider that model is served by, when not the organization's default. */
  providerOverride?: string;
}

export interface ClassifyMessageResult {
  skipped: boolean;
  intent?: MessageAiIntent;
  confidence?: number;
  summary?: string;
  suggestedReply?: string;
  options?: { label: string; body: string }[];
  clarifyingQuestion?: string;
}

export interface PersistClassificationParams {
  organizationId: string;
  messageId: string;
  status: 'COMPLETED' | 'SKIPPED' | 'FAILED' | 'AWAITING_REPLY';
  intent?: MessageAiIntent;
  confidence?: number;
  summary?: string;
  suggestedReply?: string;
  options?: { label: string; body: string }[];
}

export interface DispatchAgentParams {
  organizationId: string;
  /**
   * The inbound message being acted on. Keys the idempotency guard, so a
   * retried dispatch never drafts a second quote or re-sends an ack for it.
   */
  messageId: string;
  provider: ChannelProviderType;
  senderIdentifier: string;
  contactId: string;
  messageBody: string;
  intent: MessageAiIntent;
  confidence: number;
  summary: string;
}

export type DispatchAgentReason =
  'DISPATCHED' | 'NO_AGENT' | 'LOW_CONFIDENCE' | 'PROVIDER_INELIGIBLE';

export interface DispatchAgentResult {
  autoAcked: boolean;
  createdQuoteId?: string;
  reason: DispatchAgentReason;
}

export interface PersistDispatchResultParams {
  organizationId: string;
  messageId: string;
  autoAcked: boolean;
  createdQuoteId?: string;
}

/**
 * Static per-conversation context for `channelConversationWorkflow` — every
 * actual message body flows in later via `newInboundMessageSignal`, including
 * the first one, so the first message is never double-delivered between the
 * start args and the initial signal from `signalWithStart`.
 */
export interface ChannelConversationWorkflowInput {
  organizationId: string;
  provider: ChannelProviderType;
  contactId: string;
  senderIdentifier: string;
  /** Resolved once from IntentAgentConfig by ChannelsService before the workflow starts. */
  maxTurns: number;
  replyTimeoutMinutes: number;
  systemPrompt: string | null;
  /** Null runs on the organization's default model. */
  model: string | null;
  /** Null or absent runs on the organization's default AI provider. */
  aiProvider?: string | null;
}

export interface NewInboundMessagePayload {
  messageId: string;
  body: string;
}

export const newInboundMessageSignal =
  defineSignal<[NewInboundMessagePayload]>('newInboundMessage');

export interface SendClarifyingQuestionParams {
  organizationId: string;
  provider: ChannelProviderType;
  senderIdentifier: string;
  contactId: string;
  question: string;
}

export interface HandOverToHumanParams {
  organizationId: string;
  provider: ChannelProviderType;
  contactId: string;
  senderIdentifier: string;
  reason: ChannelHandoverReason;
  /** What the AI understood so far, shown to whoever picks the conversation up. */
  summary?: string | null;
  /** Tell the customer a person will reply. Only where the AI has been chatting with them. */
  notifyCustomer: boolean;
}
