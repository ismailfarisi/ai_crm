import { ChannelProviderType } from '../entities/channel-config.entity';
import { MessageAiIntent } from '../entities/channel-message.entity';

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
  messageBody: string;
}

export interface ClassifyMessageResult {
  skipped: boolean;
  intent?: MessageAiIntent;
  confidence?: number;
  summary?: string;
  suggestedReply?: string;
  options?: { label: string; body: string }[];
}

export interface PersistClassificationParams {
  messageId: string;
  status: 'COMPLETED' | 'SKIPPED' | 'FAILED';
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

export interface DispatchAgentResult {
  autoAcked: boolean;
  createdQuoteId?: string;
}

export interface PersistDispatchResultParams {
  messageId: string;
  autoAcked: boolean;
  createdQuoteId?: string;
}
