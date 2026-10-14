import { createChannelAiActivities } from './channel-ai.activities';
import { ChannelProviderType } from '../../entities/channel-config.entity';
import { MessageAiIntent } from '../../entities/channel-message.entity';
import { AiAgentActionType } from '../../entities/ai-agent.entity';

/**
 * Same contract as ChannelIdempotencyService.runOnce (record on success,
 * release on failure), in memory. The database mechanics are covered by
 * channel-idempotency.service.spec.ts.
 */
function makeIdempotency() {
  const done = new Map<string, unknown>();
  return {
    done,
    runOnce: jest.fn(
      async (tenantId: string, key: string, fn: () => Promise<unknown>) => {
        const k = `${tenantId}:${key}`;
        if (done.has(k)) return done.get(k);
        const result = await fn();
        done.set(k, result);
        return result;
      },
    ),
  };
}

function makeActivities(sendMessage: jest.Mock) {
  const quotesService = {
    createQuote: jest
      .fn()
      .mockImplementation(async () => ({
        id: `quote-${quotesService.createQuote.mock.calls.length}`,
      })),
  };
  const idempotency = makeIdempotency();
  const activities = createChannelAiActivities({
    aiService: {} as any,
    channelsService: { sendMessage } as any,
    quotesService: quotesService as any,
    aiAgentService: {
      findEnabledForIntent: jest.fn().mockResolvedValue({
        actionType: AiAgentActionType.CREATE_DRAFT_QUOTE,
        eligibleProviders: [ChannelProviderType.EMAIL_RESEND],
        confidenceThreshold: 0.5,
        config: { template: 'Thanks — we are on it.' },
      }),
    } as any,
    tenantContext: { runWithTenant: (_t: string, fn: any) => fn() } as any,
    idempotency: idempotency as any,
  });
  return { activities, quotesService, idempotency };
}

const params = {
  organizationId: 'org-1',
  messageId: 'msg-1',
  provider: ChannelProviderType.EMAIL_RESEND,
  senderIdentifier: 'buyer@acme.com',
  contactId: 'contact-1',
  messageBody: 'Please quote 500 boxes',
  intent: MessageAiIntent.QUOTATION_REQUEST,
  confidence: 0.9,
  summary: 'Quote for 500 boxes',
};

describe('dispatchAgentActivity idempotency', () => {
  it('does not draft a second quote when the activity is retried after succeeding', async () => {
    const sendMessage = jest.fn().mockResolvedValue({});
    const { activities, quotesService } = makeActivities(sendMessage);

    const first = await activities.dispatchAgentActivity(params);
    const retry = await activities.dispatchAgentActivity(params);

    expect(quotesService.createQuote).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(retry.createdQuoteId).toBe(first.createdQuoteId);
  });

  it('retries only the acknowledgement when sending it failed after the quote was drafted', async () => {
    const sendMessage = jest
      .fn()
      .mockRejectedValueOnce(new Error('SMTP down'))
      .mockResolvedValueOnce({});
    const { activities, quotesService } = makeActivities(sendMessage);

    await expect(activities.dispatchAgentActivity(params)).rejects.toThrow(
      'SMTP down',
    );
    const retry = await activities.dispatchAgentActivity(params);

    expect(quotesService.createQuote).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(retry).toEqual(
      expect.objectContaining({ autoAcked: true, createdQuoteId: 'quote-1' }),
    );
  });

  it('keys the guard on the inbound message, so a different message drafts its own quote', async () => {
    const sendMessage = jest.fn().mockResolvedValue({});
    const { activities, quotesService } = makeActivities(sendMessage);

    await activities.dispatchAgentActivity(params);
    await activities.dispatchAgentActivity({ ...params, messageId: 'msg-2' });

    expect(quotesService.createQuote).toHaveBeenCalledTimes(2);
  });
});
