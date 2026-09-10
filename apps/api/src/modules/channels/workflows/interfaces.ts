import { defineSignal } from '@temporalio/workflow';
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
}

export interface ChannelAiWorkflowResult {
  status: 'COMPLETED' | 'SKIPPED';
  autoAcked: boolean;
  createdQuoteId?: string;
}

export interface ClassifyMessageParams {
  organizationId: string;
  transcript: ChannelTranscriptTurn[];
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
