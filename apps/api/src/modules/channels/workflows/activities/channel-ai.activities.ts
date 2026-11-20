import { AiService } from '../../../ai/ai.service';
import { ChannelsService } from '../../channels.service';
import { QuotesService } from '../../../quotes/quotes.service';
import { AiAgentService } from '../../services/ai-agent.service';
import { ChannelIdempotencyService } from '../../services/channel-idempotency.service';
import { TenantContextService } from '@/common/context/tenant-context.service';
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
  SendClarifyingQuestionParams,
  HandOverToHumanParams,
  RunCustomerAgentTurnParams,
  RunCustomerAgentTurnResult,
  SendAgentReplyParams,
} from '../interfaces';
import { ChannelAgentRunner } from '../../agents/channel-agent-runner';
import type { ChannelAgentService } from '../../services/channel-agent.service';
import type { CustomerSenderService } from '../../services/customer-sender.service';
import type { CustomerLookupService } from '../../services/customer-lookup.service';
import { DEFAULT_HANDOVER_MESSAGE } from '@saas/shared';
import type { ChannelThreadService } from '../../services/channel-thread.service';
import type { IntentAgentConfigService } from '../../services/intent-agent-config.service';

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
  tenantContext: TenantContextService;
  idempotency: Pick<ChannelIdempotencyService, 'runOnce'>;
  threads?: Pick<ChannelThreadService, 'handOver' | 'getOrCreate' | 'setAgent'>;
  channelAgents?: Pick<ChannelAgentService, 'findEnabled'>;
  customerSenders?: Pick<CustomerSenderService, 'resolve'>;
  customerLookup?: Pick<CustomerLookupService, 'orders' | 'quotes'>;
  intentAgentConfigService?: Pick<IntentAgentConfigService, 'getEffective'>;
}) {
  const classifier = new IntentClassifierAgent(deps.aiService);
  const actionHandlers = createActionHandlerRegistry({
    channelsService: deps.channelsService,
    quotesService: deps.quotesService,
  });

  const agentRunner = deps.channelAgents
    ? new ChannelAgentRunner({
        aiService: deps.aiService,
        agents: deps.channelAgents,
        threads: deps.threads,
        quotesService: deps.quotesService,
        senders: deps.customerSenders,
        lookup: deps.customerLookup,
      })
    : null;

  return {
    /**
     * Gives the message to the organization's own agents, if one of them
     * answers on this channel and takes it. `NO_AGENT` means none did, and
     * the caller carries on with classification and the reply rules.
     */
    async runCustomerAgentTurnActivity(
      params: RunCustomerAgentTurnParams,
    ): Promise<RunCustomerAgentTurnResult> {
      const none: RunCustomerAgentTurnResult = {
        outcome: 'NO_AGENT',
        agentName: null,
        reply: null,
        handoverReason: null,
        handoverSummary: null,
      };
      if (!agentRunner) return none;
      return deps.tenantContext.runWithTenant(
        params.organizationId,
        async () => {
          const transcript = await deps.channelsService.getTranscript(
            params.organizationId,
            params.provider,
            params.contactId,
          );
          const result = await agentRunner.runCustomerTurn({
            organizationId: params.organizationId,
            provider: params.provider,
            contactId: params.contactId,
            senderIdentifier: params.senderIdentifier,
            transcript,
            runOnce: <T>(step: string, fn: () => Promise<T>) =>
              deps.idempotency.runOnce<T>(
                params.organizationId,
                `channel-ai:agent:${params.messageId}:${step}`,
                fn,
              ),
          });
          return {
            outcome: result.outcome,
            agentName: result.agent?.name ?? null,
            reply: result.reply,
            handoverReason: result.handoverReason,
            handoverSummary: result.handoverSummary,
            ...(result.createdQuoteId
              ? { createdQuoteId: result.createdQuoteId }
              : {}),
          };
        },
      );
    },

    async sendAgentReplyActivity(params: SendAgentReplyParams): Promise<void> {
      await deps.tenantContext.runWithTenant(params.organizationId, () =>
        deps.idempotency.runOnce(
          params.organizationId,
          `channel-ai:agent:${params.messageId}:send-reply`,
          async () => {
            await deps.channelsService.sendMessage(
              params.organizationId,
              'system:ai-agent',
              {
                provider: params.provider,
                recipient: params.senderIdentifier,
                contactId: params.contactId,
                body: params.reply,
              },
            );
            return true;
          },
        ),
      );
    },

    async classifyMessageActivity(
      params: ClassifyMessageParams,
    ): Promise<ClassifyMessageResult> {
      const result = await deps.tenantContext.runWithTenant(
        params.organizationId,
        () =>
          classifier.classify(
            params.organizationId,
            params.transcript,
            params.systemPromptOverride,
            params.modelOverride,
            params.providerOverride,
          ),
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
        clarifyingQuestion: c.clarifyingQuestion,
      };
    },

    async persistClassificationActivity(
      params: PersistClassificationParams,
    ): Promise<void> {
      await deps.tenantContext.runWithTenant(params.organizationId, () =>
        deps.channelsService.updateAiClassification(params.messageId, {
          aiProcessingStatus: params.status as MessageAiProcessingStatus,
          ...(params.status === 'AWAITING_REPLY'
            ? {}
            : {
                aiIntent: params.intent ?? null,
                aiConfidence: params.confidence ?? null,
                aiSummary: params.summary ?? null,
                aiSuggestedReply: params.suggestedReply ?? null,
                aiSuggestedReplyOptions: params.options ?? [],
              }),
        }),
      );
    },

    async dispatchAgentActivity(
      params: DispatchAgentParams,
    ): Promise<DispatchAgentResult> {
      return deps.tenantContext.runWithTenant(
        params.organizationId,
        async () => {
          const agent = await deps.aiAgentService.findEnabledForIntent(
            params.organizationId,
            params.intent,
          );
          if (!agent) return { autoAcked: false, reason: 'NO_AGENT' };
          if (!agent.eligibleProviders.includes(params.provider)) {
            return { autoAcked: false, reason: 'PROVIDER_INELIGIBLE' };
          }
          if (params.confidence < agent.confidenceThreshold) {
            return { autoAcked: false, reason: 'LOW_CONFIDENCE' };
          }

          const handler = actionHandlers[agent.actionType];
          if (!handler) return { autoAcked: false, reason: 'NO_AGENT' };

          // This activity is retried (maximumAttempts 3), including after an
          // attempt that timed out while its work was still running. Every
          // mutation a handler performs is keyed on the inbound message, so
          // a retry returns what was already done instead of drafting a
          // second quote or re-sending an ack.
          const runOnce = <T>(step: string, fn: () => Promise<T>) =>
            deps.idempotency.runOnce<T>(
              params.organizationId,
              `channel-ai:dispatch:${params.messageId}:${step}`,
              fn,
            );

          const result = await handler.handle(
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
              runOnce,
            },
            agent,
          );

          return { ...result, reason: 'DISPATCHED' };
        },
      );
    },

    async persistDispatchResultActivity(
      params: PersistDispatchResultParams,
    ): Promise<void> {
      await deps.tenantContext.runWithTenant(params.organizationId, () =>
        deps.channelsService.updateAiClassification(params.messageId, {
          aiAutoAcked: params.autoAcked,
          ...(params.createdQuoteId
            ? { aiCreatedQuoteId: params.createdQuoteId }
            : {}),
        }),
      );
    },

    async sendClarifyingQuestionActivity(
      params: SendClarifyingQuestionParams,
    ): Promise<void> {
      await deps.tenantContext.runWithTenant(params.organizationId, () =>
        deps.channelsService.sendMessage(
          params.organizationId,
          'system:ai-clarify',
          {
            provider: params.provider,
            recipient: params.senderIdentifier,
            contactId: params.contactId,
            body: params.question,
          },
        ),
      );
    },

    /**
     * The AI steps back from a conversation: it is marked as needing a
     * person, staff are notified, and the customer is told when the AI had
     * been talking to them. Does nothing if a person already holds it.
     */
    async handOverToHumanActivity(
      params: HandOverToHumanParams,
    ): Promise<{ handedOver: boolean }> {
      const { threads, intentAgentConfigService } = deps;
      if (!threads) return { handedOver: false };
      return deps.tenantContext.runWithTenant(
        params.organizationId,
        async () => {
          const { handedOver } = await threads.handOver({
            organizationId: params.organizationId,
            provider: params.provider,
            contactId: params.contactId,
            reason: params.reason,
            summary: params.summary,
          });
          if (handedOver && params.notifyCustomer) {
            const config = await intentAgentConfigService?.getEffective(
              params.organizationId,
            );
            await deps.channelsService.sendMessage(
              params.organizationId,
              'system:ai-handover',
              {
                provider: params.provider,
                recipient: params.senderIdentifier,
                contactId: params.contactId,
                body: config?.handoverMessage?.trim() || DEFAULT_HANDOVER_MESSAGE,
              },
            );
          }
          return { handedOver };
        },
      );
    },
  };
}
