import { AiService } from '../../../ai/ai.service';
import { ChannelsService } from '../../channels.service';
import { QuotesService } from '../../../quotes/quotes.service';
import { AiAgentService } from '../../services/ai-agent.service';
import {
  MessageAiIntent,
  MessageAiProcessingStatus,
} from '../../entities/channel-message.entity';
import { IntentClassifierAgent } from '../../agents/intent-classifier.agent';
import { createActionHandlerRegistry } from '../../agents/action-handler.registry';
import {
  ClassifyMessageParams,
  ClassifyMessageResult,
  DispatchAgentParams,
  DispatchAgentResult,
  PersistClassificationParams,
  PersistDispatchResultParams,
} from '../interfaces';

/**
 * Thin Temporal adapter — all real logic lives in the classifier/handlers.
 * A factory (not static exports, unlike the other stub activity modules in
 * this repo) so it can close over real, DI-resolved services rather than
 * reimplementing AiService's budget/logging logic DI-free.
 */
export function createChannelAiActivities(deps: {
  aiService: AiService;
  channelsService: ChannelsService;
  quotesService: QuotesService;
  aiAgentService: AiAgentService;
}) {
  const classifier = new IntentClassifierAgent(deps.aiService);
  const actionHandlers = createActionHandlerRegistry({
    channelsService: deps.channelsService,
    quotesService: deps.quotesService,
  });

  return {
    async classifyMessageActivity(
      params: ClassifyMessageParams,
    ): Promise<ClassifyMessageResult> {
      const result = await classifier.classify(
        params.organizationId,
        params.messageBody,
      );
      if (result.skipped) {
        return { skipped: true };
      }
      const c = result.classification;
      return {
        skipped: false,
        intent: c.intent as MessageAiIntent,
        confidence: c.confidence,
        summary: c.summary,
        suggestedReply: c.suggestedReply,
        options: c.options,
      };
    },

    async persistClassificationActivity(
      params: PersistClassificationParams,
    ): Promise<void> {
      await deps.channelsService.updateAiClassification(params.messageId, {
        aiProcessingStatus: params.status as MessageAiProcessingStatus,
        aiIntent: params.intent ?? null,
        aiConfidence: params.confidence ?? null,
        aiSummary: params.summary ?? null,
        aiSuggestedReply: params.suggestedReply ?? null,
        aiSuggestedReplyOptions: params.options ?? [],
      });
    },

    async dispatchAgentActivity(
      params: DispatchAgentParams,
    ): Promise<DispatchAgentResult> {
      const agent = await deps.aiAgentService.findEnabledForIntent(
        params.organizationId,
        params.intent,
      );
      if (!agent) return { autoAcked: false };
      if (params.confidence < agent.confidenceThreshold) {
        return { autoAcked: false };
      }
      if (!agent.eligibleProviders.includes(params.provider)) {
        return { autoAcked: false };
      }

      const handler = actionHandlers[agent.actionType];
      if (!handler) return { autoAcked: false };

      return handler.handle(
        {
          organizationId: params.organizationId,
          provider: params.provider,
          senderIdentifier: params.senderIdentifier,
          contactId: params.contactId,
          messageBody: params.messageBody,
          classification: {
            intent: params.intent,
            confidence: params.confidence,
            summary: params.summary,
          },
        },
        agent,
      );
    },

    async persistDispatchResultActivity(
      params: PersistDispatchResultParams,
    ): Promise<void> {
      await deps.channelsService.updateAiClassification(params.messageId, {
        aiAutoAcked: params.autoAcked,
        ...(params.createdQuoteId
          ? { aiCreatedQuoteId: params.createdQuoteId }
          : {}),
      });
    },
  };
}
