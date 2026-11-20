const mockActivities = {
  classifyMessageActivity: jest.fn(),
  persistClassificationActivity: jest.fn(),
  dispatchAgentActivity: jest.fn(),
  persistDispatchResultActivity: jest.fn(),
  sendClarifyingQuestionActivity: jest.fn(),
  handOverToHumanActivity: jest.fn(),
  runCustomerAgentTurnActivity: jest.fn(),
  sendAgentReplyActivity: jest.fn(),
};
const mockHandlers = new Map<any, (payload: any) => void>();

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () =>
    new Proxy(
      {},
      {
        get:
          (_target, name: string) =>
          (...args: any[]) =>
            (global as any).__channelAiActivities[name](...args),
      },
    ),
  setHandler: (def: any, handler: (payload: any) => void) => {
    (global as any).__channelAiHandlers.set(def, handler);
  },
  // A reply is "waiting" exactly when the test queued one. Checked a tick
  // later so messages delivered right after the workflow starts are seen.
  condition: async (predicate: () => boolean) => {
    await Promise.resolve();
    return predicate();
  },
  patched: () => true,
  defineSignal: (name: string) => ({ name }),
}));

(global as any).__channelAiActivities = mockActivities;
(global as any).__channelAiHandlers = mockHandlers;

import {
  channelAiWorkflow,
  channelConversationWorkflow,
} from './channel-ai.workflow';
import { newInboundMessageSignal } from './interfaces';
import { ChannelProviderType } from '../entities/channel-config.entity';

const base = {
  organizationId: 'org-1',
  provider: ChannelProviderType.WHATSAPP_META,
  contactId: 'contact-1',
  senderIdentifier: '971500000000',
};
const oneShot = { ...base, messageId: 'm-1', body: 'hello' };
const conversation = {
  ...base,
  maxTurns: 2,
  replyTimeoutMinutes: 15,
  systemPrompt: null,
  model: null,
};
const classified = (over: Record<string, unknown> = {}) => ({
  skipped: false,
  intent: 'GENERAL_QUESTION',
  confidence: 0.9,
  summary: 'Asks about opening hours',
  ...over,
});
const noAgent = {
  outcome: 'NO_AGENT',
  agentName: null,
  reply: null,
  handoverReason: null,
  handoverSummary: null,
};
const handover = () => mockActivities.handOverToHumanActivity.mock.calls[0]?.[0];

/** Runs the conversation workflow with these customer messages already delivered. */
async function converse(bodies: string[]) {
  const run = channelConversationWorkflow(conversation);
  const deliver = mockHandlers.get(newInboundMessageSignal)!;
  bodies.forEach((body, i) => deliver({ messageId: `m-${i + 1}`, body }));
  return run;
}

describe('channel AI workflows: handover', () => {
  beforeEach(() => {
    Object.values(mockActivities).forEach((fn) => fn.mockReset());
    mockHandlers.clear();
    mockActivities.handOverToHumanActivity.mockResolvedValue({ handedOver: true });
    mockActivities.runCustomerAgentTurnActivity.mockResolvedValue(noAgent);
  });

  describe('one-shot', () => {
    it('sends a request for a person straight to one without running a rule', async () => {
      mockActivities.classifyMessageActivity.mockResolvedValue(
        classified({ intent: 'HUMAN_REQUEST' }),
      );
      await channelAiWorkflow(oneShot);
      expect(mockActivities.dispatchAgentActivity).not.toHaveBeenCalled();
      expect(handover()).toMatchObject({
        reason: 'HUMAN_REQUESTED',
        summary: 'Asks about opening hours',
        notifyCustomer: false,
      });
    });

    it('still runs the complaint rule, then hands the complaint to a person', async () => {
      mockActivities.classifyMessageActivity.mockResolvedValue(
        classified({ intent: 'COMPLAINT' }),
      );
      mockActivities.dispatchAgentActivity.mockResolvedValue({
        autoAcked: true,
        reason: 'DISPATCHED',
      });
      const result = await channelAiWorkflow(oneShot);
      expect(result.autoAcked).toBe(true);
      expect(handover()).toMatchObject({ reason: 'COMPLAINT' });
    });

    it.each([
      ['NO_AGENT', 'NO_AGENT'],
      ['LOW_CONFIDENCE', 'LOW_CONFIDENCE'],
      ['PROVIDER_INELIGIBLE', 'NO_AGENT'],
    ])('hands over when no rule acted (%s)', async (dispatchReason, reason) => {
      mockActivities.classifyMessageActivity.mockResolvedValue(classified());
      mockActivities.dispatchAgentActivity.mockResolvedValue({
        autoAcked: false,
        reason: dispatchReason,
      });
      await channelAiWorkflow(oneShot);
      expect(handover()).toMatchObject({ reason, notifyCustomer: false });
    });

    it('keeps the conversation with the AI when a rule handled it', async () => {
      mockActivities.classifyMessageActivity.mockResolvedValue(classified());
      mockActivities.dispatchAgentActivity.mockResolvedValue({
        autoAcked: true,
        reason: 'DISPATCHED',
      });
      const result = await channelAiWorkflow(oneShot);
      expect(result.autoAcked).toBe(true);
      expect(mockActivities.handOverToHumanActivity).not.toHaveBeenCalled();
    });

    it('hands over when the AI itself fails', async () => {
      mockActivities.classifyMessageActivity.mockRejectedValue(new Error('provider down'));
      const result = await channelAiWorkflow(oneShot);
      expect(result.status).toBe('FAILED');
      expect(handover()).toMatchObject({ reason: 'ERROR' });
    });

    it('leaves a message alone when AI is switched off', async () => {
      mockActivities.classifyMessageActivity.mockResolvedValue({ skipped: true });
      await channelAiWorkflow(oneShot);
      expect(mockActivities.handOverToHumanActivity).not.toHaveBeenCalled();
    });

    it('still completes when the handover cannot be recorded', async () => {
      mockActivities.classifyMessageActivity.mockResolvedValue(
        classified({ intent: 'HUMAN_REQUEST' }),
      );
      mockActivities.handOverToHumanActivity.mockRejectedValue(new Error('db down'));
      await expect(channelAiWorkflow(oneShot)).resolves.toMatchObject({
        status: 'COMPLETED',
      });
    });
  });

  describe('conversation', () => {
    it('tells the customer a person will reply when they ask for one', async () => {
      mockActivities.classifyMessageActivity.mockResolvedValue(
        classified({ intent: 'HUMAN_REQUEST' }),
      );
      await converse(['can I talk to someone?']);
      expect(mockActivities.dispatchAgentActivity).not.toHaveBeenCalled();
      expect(handover()).toMatchObject({
        reason: 'HUMAN_REQUESTED',
        notifyCustomer: true,
      });
    });

    it('hands a complaint over once, telling the customer only when nothing was sent', async () => {
      mockActivities.classifyMessageActivity.mockResolvedValue(
        classified({ intent: 'COMPLAINT', clarifyingQuestion: 'What went wrong?' }),
      );
      mockActivities.dispatchAgentActivity.mockResolvedValue({
        autoAcked: false,
        reason: 'NO_AGENT',
      });
      await converse(['the boxes arrived crushed']);
      expect(mockActivities.sendClarifyingQuestionActivity).not.toHaveBeenCalled();
      expect(mockActivities.handOverToHumanActivity).toHaveBeenCalledTimes(1);
      expect(handover()).toMatchObject({ reason: 'COMPLAINT', notifyCustomer: true });
    });

    it('hands over, telling the customer, after running out of clarifying turns', async () => {
      mockActivities.classifyMessageActivity.mockResolvedValue(
        classified({ clarifyingQuestion: 'What do you need?' }),
      );
      mockActivities.dispatchAgentActivity.mockResolvedValue({
        autoAcked: false,
        reason: 'LOW_CONFIDENCE',
      });
      await converse(['hi', 'hmm']);
      expect(mockActivities.sendClarifyingQuestionActivity).toHaveBeenCalledTimes(2);
      expect(handover()).toMatchObject({
        reason: 'UNRESOLVED',
        summary: 'Asks about opening hours',
        notifyCustomer: true,
      });
    });

    it('hands over quietly when the customer never answers the question', async () => {
      mockActivities.classifyMessageActivity.mockResolvedValue(
        classified({ clarifyingQuestion: 'What do you need?' }),
      );
      mockActivities.dispatchAgentActivity.mockResolvedValue({
        autoAcked: false,
        reason: 'LOW_CONFIDENCE',
      });
      await converse(['hi']);
      expect(handover()).toMatchObject({
        reason: 'UNRESOLVED',
        notifyCustomer: false,
      });
    });
  });

  describe('agents', () => {
    const replied = { ...noAgent, outcome: 'REPLIED', agentName: 'Sales', reply: 'What size?' };

    it('lets an agent answer, and skips classification and the rules', async () => {
      mockActivities.runCustomerAgentTurnActivity.mockResolvedValue(replied);

      const result = await channelAiWorkflow(oneShot);

      expect(mockActivities.sendAgentReplyActivity).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: 'm-1', reply: 'What size?' }),
      );
      expect(mockActivities.classifyMessageActivity).not.toHaveBeenCalled();
      expect(mockActivities.dispatchAgentActivity).not.toHaveBeenCalled();
      expect(mockActivities.persistClassificationActivity).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'COMPLETED', summary: 'Answered by Sales' }),
      );
      expect(result).toMatchObject({ status: 'COMPLETED', autoAcked: true });
    });

    it('carries on as before when no agent takes the message, or the agents fail', async () => {
      mockActivities.classifyMessageActivity.mockResolvedValue({ skipped: true });
      await channelAiWorkflow(oneShot);
      mockActivities.runCustomerAgentTurnActivity.mockRejectedValue(new Error('provider down'));
      await channelAiWorkflow(oneShot);

      expect(mockActivities.classifyMessageActivity).toHaveBeenCalledTimes(2);
      expect(mockActivities.sendAgentReplyActivity).not.toHaveBeenCalled();
    });

    it("hands over with the agent's reason and summary, telling a chat customer", async () => {
      mockActivities.runCustomerAgentTurnActivity.mockResolvedValue({
        ...noAgent,
        outcome: 'HANDOVER',
        agentName: 'Sales',
        handoverReason: 'COMPLAINT',
        handoverSummary: 'Unhappy about a late order',
      });

      await converse(['this is the third time it is late']);

      expect(handover()).toMatchObject({
        reason: 'COMPLAINT',
        summary: 'Unhappy about a late order',
        notifyCustomer: true,
      });
      expect(mockActivities.classifyMessageActivity).not.toHaveBeenCalled();
    });

    it('answers each waiting message, without spending clarifying turns', async () => {
      mockActivities.runCustomerAgentTurnActivity.mockResolvedValue(replied);

      await converse(['hi', 'I need boxes', '500 of them']);

      expect(mockActivities.sendAgentReplyActivity).toHaveBeenCalledTimes(3);
      expect(mockActivities.handOverToHumanActivity).not.toHaveBeenCalled();
    });

    it('gives the conversation to a person when the reply cannot be delivered', async () => {
      mockActivities.runCustomerAgentTurnActivity.mockResolvedValue(replied);
      mockActivities.sendAgentReplyActivity.mockRejectedValue(new Error('channel down'));

      await channelAiWorkflow(oneShot);

      expect(handover()).toMatchObject({ reason: 'ERROR', notifyCustomer: false });
    });
  });
});
