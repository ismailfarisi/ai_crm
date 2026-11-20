import {
  condition,
  patched,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';
import type { ChannelHandoverReason } from '@saas/shared';
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
  handOverToHumanActivity,
} = proxyActivities<ReturnType<typeof activities.createChannelAiActivities>>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});

// An agent turn is several model calls, so it gets longer than the rest and
// is tried twice at most: a third attempt would mostly buy a third bill.
const { runCustomerAgentTurnActivity } = proxyActivities<
  ReturnType<typeof activities.createChannelAiActivities>
>({
  startToCloseTimeout: '3 minutes',
  retry: { maximumAttempts: 2 },
});
const { sendAgentReplyActivity } = proxyActivities<
  ReturnType<typeof activities.createChannelAiActivities>
>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});

/**
 * Intents that always end with a person. A request for one skips the rules
 * entirely; a complaint still runs its rule first (so an acknowledgement an
 * organization has set up keeps going out) and is handed over afterwards.
 */
const HUMAN_REQUEST = 'HUMAN_REQUEST';
const COMPLAINT = 'COMPLAINT';

/**
 * Hands the conversation to a person. Never fails the workflow: a handover
 * that cannot be recorded leaves things as they were before handover existed.
 * `patched` keeps executions started before this change replaying cleanly.
 */
async function handOver(
  input: Pick<
    ChannelConversationWorkflowInput,
    'organizationId' | 'provider' | 'contactId' | 'senderIdentifier'
  >,
  reason: ChannelHandoverReason,
  summary: string | null | undefined,
  notifyCustomer: boolean,
): Promise<void> {
  if (!patched('handover-v1')) return;
  try {
    await handOverToHumanActivity({
      organizationId: input.organizationId,
      provider: input.provider,
      contactId: input.contactId,
      senderIdentifier: input.senderIdentifier,
      reason,
      summary: summary ?? null,
      notifyCustomer,
    });
  } catch {
    // Left for a human to find in the inbox, as before.
  }
}

/**
 * Offers the message to the organization's own agents before anything else.
 *
 * Returns true when an agent dealt with it, by replying or by passing the
 * conversation to a person. False means no agent answers here or none took
 * it (or the attempt failed), and the caller carries on exactly as it did
 * before agents existed. `patched` keeps older executions replaying cleanly.
 */
async function tryAgents(
  input: Pick<
    ChannelConversationWorkflowInput,
    'organizationId' | 'provider' | 'contactId' | 'senderIdentifier'
  >,
  messageId: string,
  notifyCustomerOnHandover: boolean,
): Promise<{ handled: boolean; handedOver: boolean; createdQuoteId?: string }> {
  const notHandled = { handled: false, handedOver: false };
  if (!patched('agents-v1')) return notHandled;
  let turn: Awaited<ReturnType<typeof runCustomerAgentTurnActivity>>;
  try {
    turn = await runCustomerAgentTurnActivity({
      organizationId: input.organizationId,
      provider: input.provider,
      contactId: input.contactId,
      senderIdentifier: input.senderIdentifier,
      messageId,
    });
  } catch {
    return notHandled;
  }
  if (turn.outcome === 'NO_AGENT') return notHandled;

  const summary =
    turn.outcome === 'HANDOVER'
      ? (turn.handoverSummary ?? `Passed to a person by ${turn.agentName}`)
      : `Answered by ${turn.agentName}`;

  if (turn.outcome === 'REPLIED' && turn.reply) {
    try {
      await sendAgentReplyActivity({
        organizationId: input.organizationId,
        provider: input.provider,
        senderIdentifier: input.senderIdentifier,
        contactId: input.contactId,
        messageId,
        reply: turn.reply,
      });
    } catch {
      // The reply could not be delivered: a person must see this one.
      await persistClassificationActivity({
        organizationId: input.organizationId,
        messageId,
        status: 'COMPLETED',
        summary,
        suggestedReply: turn.reply,
      });
      await handOver(input, 'ERROR', summary, false);
      return { handled: true, handedOver: true };
    }
  }

  await persistClassificationActivity({
    organizationId: input.organizationId,
    messageId,
    status: 'COMPLETED',
    summary,
  });
  if (turn.createdQuoteId || turn.outcome === 'REPLIED') {
    await persistDispatchResultActivity({
      organizationId: input.organizationId,
      messageId,
      autoAcked: turn.outcome === 'REPLIED',
      createdQuoteId: turn.createdQuoteId,
    });
  }
  if (turn.outcome === 'HANDOVER') {
    await handOver(
      input,
      turn.handoverReason ?? 'UNRESOLVED',
      summary,
      notifyCustomerOnHandover,
    );
    return {
      handled: true,
      handedOver: true,
      createdQuoteId: turn.createdQuoteId,
    };
  }
  return { handled: true, handedOver: false, createdQuoteId: turn.createdQuoteId };
}

/** Why dispatch did not act, as a handover reason. */
function reasonFor(dispatchReason: string): ChannelHandoverReason {
  return dispatchReason === 'LOW_CONFIDENCE' ? 'LOW_CONFIDENCE' : 'NO_AGENT';
}

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
  const byAgent = await tryAgents(input, input.messageId, false);
  if (byAgent.handled) {
    return {
      status: 'COMPLETED',
      autoAcked: !byAgent.handedOver,
      createdQuoteId: byAgent.createdQuoteId,
    };
  }

  let classified: Awaited<ReturnType<typeof classifyMessageActivity>>;
  try {
    classified = await classifyMessageActivity({
      organizationId: input.organizationId,
      transcript: [{ role: 'customer', body: input.body }],
      modelOverride: input.model ?? undefined,
      providerOverride: input.aiProvider ?? undefined,
    });
  } catch {
    // Exhausted retries (e.g. the org's AI provider is unreachable or too
    // slow) — mark it FAILED instead of leaving the message stuck at PENDING
    // forever with no way for a human to tell something went wrong.
    await persistClassificationActivity({
      organizationId: input.organizationId,
      messageId: input.messageId,
      status: 'FAILED',
    });
    await handOver(input, 'ERROR', null, false);
    return { status: 'FAILED', autoAcked: false };
  }

  if (classified.skipped) {
    await persistClassificationActivity({
      organizationId: input.organizationId,
      messageId: input.messageId,
      status: 'SKIPPED',
    });
    return { status: 'SKIPPED', autoAcked: false };
  }

  await persistClassificationActivity({
    organizationId: input.organizationId,
    messageId: input.messageId,
    status: 'COMPLETED',
    intent: classified.intent,
    confidence: classified.confidence,
    summary: classified.summary,
    suggestedReply: classified.suggestedReply,
    options: classified.options,
  });

  if (classified.intent === HUMAN_REQUEST) {
    await handOver(input, 'HUMAN_REQUESTED', classified.summary, false);
    return { status: 'COMPLETED', autoAcked: false };
  }

  try {
    const dispatchResult = await dispatchAgentActivity({
      organizationId: input.organizationId,
      messageId: input.messageId,
      provider: input.provider,
      senderIdentifier: input.senderIdentifier,
      contactId: input.contactId,
      messageBody: input.body,
      intent: classified.intent!,
      confidence: classified.confidence!,
      summary: classified.summary!,
    });

    await persistDispatchResultActivity({
      organizationId: input.organizationId,
      messageId: input.messageId,
      autoAcked: dispatchResult.autoAcked,
      createdQuoteId: dispatchResult.createdQuoteId,
    });

    if (classified.intent === COMPLAINT) {
      await handOver(input, 'COMPLAINT', classified.summary, false);
    } else if (dispatchResult.reason !== 'DISPATCHED') {
      await handOver(
        input,
        reasonFor(dispatchResult.reason),
        classified.summary,
        false,
      );
    }

    return {
      status: 'COMPLETED',
      autoAcked: dispatchResult.autoAcked,
      createdQuoteId: dispatchResult.createdQuoteId,
    };
  } catch {
    // Classification already succeeded and is persisted — hand it to a
    // human rather than failing the whole workflow over the action step.
    await handOver(input, 'ERROR', classified.summary, false);
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
 * `systemPrompt`/`model` are resolved once by the caller and carried in `input` for
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
  let lastSummary: string | null = null;
  // False when the customer went quiet: no point telling them anything.
  let customerStillThere = true;

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
      customerStillThere = false;
      break;
    }
    const message = queue.shift()!;
    transcript.push({ role: 'customer', body: message.body });

    const byAgent = await tryAgents(input, message.messageId, true);
    if (byAgent.handled) {
      // An agent reads the conversation from the inbox, not from this
      // workflow, so there is nothing to keep it open for: the customer's
      // next message starts a fresh run. Messages that arrived meanwhile are
      // answered first, without counting against the clarifying turns.
      if (byAgent.handedOver || queue.length === 0) {
        return {
          status: 'COMPLETED',
          autoAcked: !byAgent.handedOver,
          createdQuoteId: byAgent.createdQuoteId,
        };
      }
      turn--;
      continue;
    }

    let classified: Awaited<ReturnType<typeof classifyMessageActivity>>;
    try {
      classified = await classifyMessageActivity({
        organizationId: input.organizationId,
        transcript,
        systemPromptOverride: input.systemPrompt ?? undefined,
        modelOverride: input.model ?? undefined,
        providerOverride: input.aiProvider ?? undefined,
      });
    } catch {
      // Exhausted retries — mark it FAILED instead of leaving the message
      // stuck at PENDING/AWAITING_REPLY forever with no way for a human to
      // tell the conversation stalled.
      await persistClassificationActivity({
        organizationId: input.organizationId,
        messageId: message.messageId,
        status: 'FAILED',
      });
      await handOver(input, 'ERROR', null, true);
      return { status: 'FAILED', autoAcked: false };
    }

    if (classified.skipped) {
      await persistClassificationActivity({
        organizationId: input.organizationId,
        messageId: message.messageId,
        status: 'SKIPPED',
      });
      return { status: 'SKIPPED', autoAcked: false };
    }

    await persistClassificationActivity({
      organizationId: input.organizationId,
      messageId: message.messageId,
      status: 'COMPLETED',
      intent: classified.intent,
      confidence: classified.confidence,
      summary: classified.summary,
      suggestedReply: classified.suggestedReply,
      options: classified.options,
    });
    lastSummary = classified.summary ?? lastSummary;

    if (classified.intent === HUMAN_REQUEST) {
      await handOver(input, 'HUMAN_REQUESTED', classified.summary, true);
      return { status: 'COMPLETED', autoAcked: false };
    }

    let dispatchResult: Awaited<ReturnType<typeof dispatchAgentActivity>>;
    try {
      dispatchResult = await dispatchAgentActivity({
        organizationId: input.organizationId,
        messageId: message.messageId,
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
      await handOver(input, 'ERROR', classified.summary, true);
      return { status: 'COMPLETED', autoAcked: false };
    }

    if (classified.intent === COMPLAINT) {
      // Its rule, if any, has just run. Whatever that did, a person takes a
      // complaint; the customer is told only if no acknowledgement went out.
      await handOver(
        input,
        'COMPLAINT',
        classified.summary,
        !dispatchResult.autoAcked,
      );
    }

    if (dispatchResult.reason === 'DISPATCHED') {
      await persistDispatchResultActivity({
        organizationId: input.organizationId,
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

    if (classified.intent === COMPLAINT) {
      return { status: 'COMPLETED', autoAcked: false };
    }

    if (!classified.clarifyingQuestion) {
      // The classifier is confident enough that it isn't asking a follow-up
      // question — whatever dispatch's reason was (no agent configured,
      // provider ineligible), there's nothing more clarifying would change,
      // so stop and leave it classified for a human. Deliberately NOT gated
      // on dispatchResult.reason === 'LOW_CONFIDENCE': a low-confidence
      // first guess (e.g. a bare "hi" reading as GENERAL_QUESTION, which has
      // no agent) is exactly the case that should keep chatting — the real
      // intent may only emerge, and map to a configured agent, after a turn
      // or two of clarification.
      await handOver(
        input,
        reasonFor(dispatchResult.reason),
        classified.summary,
        true,
      );
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
      await handOver(input, 'ERROR', classified.summary, false);
      return { status: 'COMPLETED', autoAcked: false };
    }

    await persistClassificationActivity({
      organizationId: input.organizationId,
      messageId: message.messageId,
      status: 'AWAITING_REPLY',
    });
    transcript.push({ role: 'agent', body: classified.clarifyingQuestion });
  }

  // Out of turns, or no reply to the last question: a person takes it from here.
  await handOver(input, 'UNRESOLVED', lastSummary, customerStillThere);
  return { status: 'COMPLETED', autoAcked: false };
}
