import { ChannelProviderType } from '../entities/channel-config.entity';
import { MessageAiIntent } from '../entities/channel-message.entity';
import { AiAgent } from '../entities/ai-agent.entity';

export interface ChannelAgentContext {
  organizationId: string;
  provider: ChannelProviderType;
  senderIdentifier: string;
  contactId: string;
  messageBody: string;
  classification: {
    intent: MessageAiIntent;
    confidence: number;
    summary: string;
  };
}

export interface ChannelAgentResult {
  autoAcked: boolean;
  createdQuoteId?: string;
}

/**
 * One action handler per `AiAgentActionType` — the fixed, in-code catalog
 * that database-configurable `AiAgent` rows dispatch into. This is the seam
 * for genuinely new capabilities; new *instances* of an existing action type
 * are a pure data operation via AiAgentService, no code change needed.
 */
export interface ActionHandler {
  handle(ctx: ChannelAgentContext, agent: AiAgent): Promise<ChannelAgentResult>;
}
