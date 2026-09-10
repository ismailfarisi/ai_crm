import { condition, proxyActivities, setHandler } from '@temporalio/workflow';
import type * as activities from './activities/channel-ai.activities';
import {
  ChannelAiWorkflowInput,
  ChannelAiWorkflowResult,
  ChannelConversationWorkflowInput,
  NewInboundMessagePayload,
  newInboundMessageSignal,
} from './interfaces';
import { ChannelTranscriptTurn } from '../agents/intent-classifier.agent';

const {
  classifyMessageActivity,
  persistClassificationActivity,
  dispatchAgentActivity,
  persistDispatchResultActivity,
  sendClarifyingQuestionActivity,
} = proxyActivities<ReturnType<typeof activities.createChannelAiActivities>>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});

/**
 * One-shot job (classify -> maybe dispatch to an agent) — no signals/queries,
 * unlike the long-running approval workflows elsewhere in this codebase.
 * Capability-agnostic by design: adding a new AiAgent action type never
 * touches this file. Used for every provider that never auto-chats (email)
 * and for the very first read on chat-eligible providers when it's already
 * confident enough to skip the back-and-forth.
 */
export async function channelAiWorkflow(
  input: ChannelAiWorkflowInput,
): Promise<ChannelAiWorkflowResult> {
  let classified: Awaited<ReturnType<typeof classifyMessageActivity>>;
  try {
    classified = await classifyMessageActivity({
      organizationId: input.organizationId,
      transcript: [{ role: 'customer', body: input.body }],
    });
  } catch {
    // Exhausted retries (e.g. the org's AI provider is unreachable or too
    // slow) — mark it FAILED instead of leaving the message stuck at PENDING
    // forever with no way for a human to tell something went wrong.
    await persistClassificationActivity({
      messageId: input.messageId,
      status: 'FAILED',
    });
    return { status: 'FAILED', autoAcked: false };
  }

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

  try {
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
  } catch {
    // Classification already succeeded and is persisted — leave it for a
    // human rather than failing the whole workflow over the action step.
    return { status: 'COMPLETED', autoAcked: false };
  }
}

/**
 * Long-running, per-contact conversation: waits for each inbound message via
 * `newInboundMessageSignal` (delivered by `ChannelsService.processInboundWebhook`
 * through `client.workflow.signalWithStart`, so the workflow id is keyed by
 * contact, not by message — a follow-up reply lands on this same execution).
 * Every message, including the first, arrives via the signal so there's no
 * risk of double-counting the opening message between start args and signal.
 *
 * Only used for providers an org has enabled auto-chat for via IntentAgentConfig
 * (defaults to WhatsApp/Telegram) — email always uses the one-shot
 * `channelAiWorkflow` above instead. `maxTurns`/`replyTimeoutMinutes`/
 * `systemPrompt` are resolved once by the caller and carried in `input` for
 * this conversation's whole lifetime, even if the org's settings change mid-chat.
 */
export async function channelConversationWorkflow(
  input: ChannelConversationWorkflowInput,
): Promise<ChannelAiWorkflowResult> {
  const queue: NewInboundMessagePayload[] = [];
  setHandler(newInboundMessageSignal, (payload) => {
    queue.push(payload);
  });

  const transcript: ChannelTranscriptTurn[] = [];

  for (let turn = 0; turn < input.maxTurns; turn++) {
    const gotMessage = await condition(
      () => queue.length > 0,
      // Dynamic duration built from org config — same `as any` escape used
      // by expense-approval.workflow.ts for its configurable SLA/timeout durations.
      `${input.replyTimeoutMinutes} minutes` as any,
    );
    if (!gotMessage) {
      // Customer went quiet — stop waiting rather than leaving this
      // workflow open indefinitely; whatever was last persisted stands.
      break;
    }
    const message = queue.shift()!;
    transcript.push({ role: 'customer', body: message.body });

    let classified: Awaited<ReturnType<typeof classifyMessageActivity>>;
    try {
      classified = await classifyMessageActivity({
        organizationId: input.organizationId,
        transcript,
        systemPromptOverride: input.systemPrompt ?? undefined,
      });
    } catch {
      // Exhausted retries — mark it FAILED instead of leaving the message
      // stuck at PENDING/AWAITING_REPLY forever with no way for a human to
      // tell the conversation stalled.
      await persistClassificationActivity({
        messageId: message.messageId,
        status: 'FAILED',
      });
      return { status: 'FAILED', autoAcked: false };
    }

    if (classified.skipped) {
      await persistClassificationActivity({
        messageId: message.messageId,
        status: 'SKIPPED',
      });
      return { status: 'SKIPPED', autoAcked: false };
    }

    await persistClassificationActivity({
      messageId: message.messageId,
      status: 'COMPLETED',
      intent: classified.intent,
      confidence: classified.confidence,
      summary: classified.summary,
      suggestedReply: classified.suggestedReply,
      options: classified.options,
    });

    let dispatchResult: Awaited<ReturnType<typeof dispatchAgentActivity>>;
    try {
      dispatchResult = await dispatchAgentActivity({
        organizationId: input.organizationId,
        provider: input.provider,
        senderIdentifier: input.senderIdentifier,
        contactId: input.contactId,
        messageBody: message.body,
        intent: classified.intent!,
        confidence: classified.confidence!,
        summary: classified.summary!,
      });
    } catch {
      // Classification already succeeded and is persisted — leave it for a
      // human rather than failing the whole conversation over the action step.
      return { status: 'COMPLETED', autoAcked: false };
    }

    if (dispatchResult.reason === 'DISPATCHED') {
      await persistDispatchResultActivity({
        messageId: message.messageId,
        autoAcked: dispatchResult.autoAcked,
        createdQuoteId: dispatchResult.createdQuoteId,
      });
      return {
        status: 'COMPLETED',
        autoAcked: dispatchResult.autoAcked,
        createdQuoteId: dispatchResult.createdQuoteId,
      };
    }

    if (
      dispatchResult.reason !== 'LOW_CONFIDENCE' ||
      !classified.clarifyingQuestion
    ) {
      // No agent configured for this intent (or provider ineligible) — no
      // specialist to eventually hand off to, so stop chatting and leave it
      // classified for a human, same ending as the one-shot path's fallback.
      return { status: 'COMPLETED', autoAcked: false };
    }

    try {
      // Send before marking AWAITING_REPLY: if delivery fails, the message
      // stays at the already-persisted COMPLETED classification instead of
      // being stuck showing "waiting for a reply" that will never come.
      await sendClarifyingQuestionActivity({
        organizationId: input.organizationId,
        provider: input.provider,
        senderIdentifier: input.senderIdentifier,
        contactId: input.contactId,
        question: classified.clarifyingQuestion,
      });
    } catch {
      return { status: 'COMPLETED', autoAcked: false };
    }

    await persistClassificationActivity({
      messageId: message.messageId,
      status: 'AWAITING_REPLY',
    });
    transcript.push({ role: 'agent', body: classified.clarifyingQuestion });
  }

  return { status: 'COMPLETED', autoAcked: false };
}
