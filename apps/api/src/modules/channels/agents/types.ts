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
  /**
   * Runs one side effect at most once for this dispatch, returning the
   * recorded result on a retry. Handlers wrap each mutation (drafting a
   * quote, sending an ack) separately, so a retry after a later step failed
   * repeats only that step. Absent outside a Temporal activity.
   */
  runOnce?: <T>(step: string, fn: () => Promise<T>) => Promise<T>;
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
