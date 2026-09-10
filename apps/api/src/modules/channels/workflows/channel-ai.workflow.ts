import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities/channel-ai.activities';
import { ChannelAiWorkflowInput, ChannelAiWorkflowResult } from './interfaces';

const {
  classifyMessageActivity,
  persistClassificationActivity,
  dispatchAgentActivity,
  persistDispatchResultActivity,
} = proxyActivities<ReturnType<typeof activities.createChannelAiActivities>>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});

/**
 * One-shot job (classify -> maybe dispatch to an agent) — no signals/queries,
 * unlike the long-running approval workflows elsewhere in this codebase.
 * Capability-agnostic by design: adding a new AiAgent action type never
 * touches this file.
 */
export async function channelAiWorkflow(
  input: ChannelAiWorkflowInput,
): Promise<ChannelAiWorkflowResult> {
  const classified = await classifyMessageActivity({
    organizationId: input.organizationId,
    messageBody: input.body,
  });

  if (classified.skipped) {
    await persistClassificationActivity({
      messageId: input.messageId,
      status: 'SKIPPED',
    });
    return { status: 'SKIPPED', autoAcked: false };
  }

  await persistClassificationActivity({
    messageId: input.messageId,
    status: 'COMPLETED',
    intent: classified.intent,
    confidence: classified.confidence,
    summary: classified.summary,
    suggestedReply: classified.suggestedReply,
    options: classified.options,
  });

  const dispatchResult = await dispatchAgentActivity({
    organizationId: input.organizationId,
    provider: input.provider,
    senderIdentifier: input.senderIdentifier,
    contactId: input.contactId,
    messageBody: input.body,
    intent: classified.intent!,
    confidence: classified.confidence!,
    summary: classified.summary!,
  });

  await persistDispatchResultActivity({
    messageId: input.messageId,
    autoAcked: dispatchResult.autoAcked,
    createdQuoteId: dispatchResult.createdQuoteId,
  });

  return {
    status: 'COMPLETED',
    autoAcked: dispatchResult.autoAcked,
    createdQuoteId: dispatchResult.createdQuoteId,
  };
}
