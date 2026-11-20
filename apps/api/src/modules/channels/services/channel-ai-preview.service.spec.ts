import { ChannelAiPreviewService } from './channel-ai-preview.service';

const orgId = 'org-1';
const WHATSAPP = 'WHATSAPP_META' as const;
const EMAIL = 'EMAIL_SMTP' as const;

function setup(
  opts: {
    classification?: Record<string, unknown> | null;
    rule?: Record<string, unknown> | null;
    config?: Record<string, unknown>;
  } = {},
) {
  const classification =
    opts.classification === null
      ? null
      : {
          intent: 'ORDER_STATUS',
          confidence: 0.9,
          summary: 'Asks where order 1042 is',
          suggestedReply: '',
          options: [],
          ...opts.classification,
        };
  const ai = {
    generateStructured: jest.fn(async () => {
      if (!classification) throw new Error('unparseable');
      return { data: classification };
    }),
  };
  const rules = {
    findEnabledForIntent: jest.fn().mockResolvedValue(opts.rule ?? null),
  };
  const intentConfig = {
    getEffective: jest.fn().mockResolvedValue({
      isEnabled: true,
      eligibleProviders: [WHATSAPP],
      systemPrompt: null,
      model: 'chat-model',
      provider: 'ANTHROPIC',
      ...opts.config,
    }),
  };
  const service = new ChannelAiPreviewService(
    ai as never,
    rules as never,
    intentConfig as never,
  );
  return { service, ai, rules };
}

const rule = (over: Record<string, unknown> = {}) => ({
  name: 'Order status reply',
  actionType: 'AUTO_ACK',
  eligibleProviders: [WHATSAPP],
  confidenceThreshold: 0.75,
  config: { template: 'We are checking on your order.' },
  ...over,
});
const options = (classification: Record<string, unknown>) => ({
  classification: {
    ...classification,
    options: [
      { label: 'a', body: 'a' },
      { label: 'b', body: 'b' },
    ],
  },
});

describe('ChannelAiPreviewService', () => {
  it('reports the rule that would run and the reply it would send', async () => {
    const { service, ai } = setup({ ...options({}), rule: rule() });
    const result = await service.preview(orgId, {
      body: 'where is my order 1042?',
      provider: WHATSAPP,
    });
    expect(result).toMatchObject({
      outcome: 'RULE',
      intent: 'ORDER_STATUS',
      confidence: 0.9,
      rule: {
        name: 'Order status reply',
        actionType: 'AUTO_ACK',
        reply: 'We are checking on your order.',
      },
      thenHandover: false,
    });
    // Read on the intent agent's own model and provider, as a live message is.
    expect(ai.generateStructured.mock.calls[0][1]).toMatchObject({
      model: 'chat-model',
      provider: 'ANTHROPIC',
    });
  });

  it('says a complaint is handed to a person even after its rule replies', async () => {
    const { service } = setup({
      ...options({ intent: 'COMPLAINT' }),
      rule: rule({ name: 'Complaint reply' }),
    });
    const result = await service.preview(orgId, { body: 'broken', provider: WHATSAPP });
    expect(result).toMatchObject({ outcome: 'RULE', thenHandover: true });
  });

  it('hands a request for a person over without looking for a rule', async () => {
    const { service, rules } = setup(options({ intent: 'HUMAN_REQUEST' }));
    const result = await service.preview(orgId, { body: 'agent please', provider: WHATSAPP });
    expect(result).toMatchObject({
      outcome: 'HANDOVER',
      handoverReason: 'HUMAN_REQUESTED',
    });
    expect(rules.findEnabledForIntent).not.toHaveBeenCalled();
  });

  it('asks the question on a channel the AI may chat on', async () => {
    const { service } = setup(
      options({ confidence: 0.4, clarifyingQuestion: 'Which order is this about?' }),
    );
    const result = await service.preview(orgId, { body: 'hi', provider: WHATSAPP });
    expect(result).toMatchObject({
      outcome: 'ASK',
      question: 'Which order is this about?',
    });
  });

  it('hands over instead of asking on a channel the AI may not chat on', async () => {
    const { service } = setup(
      options({ confidence: 0.4, clarifyingQuestion: 'Which order is this about?' }),
    );
    const result = await service.preview(orgId, { body: 'hi', provider: EMAIL });
    expect(result).toMatchObject({ outcome: 'HANDOVER', handoverReason: 'NO_AGENT' });
  });

  it('explains a rule that did not run because the AI was not sure enough', async () => {
    const { service } = setup({ ...options({ confidence: 0.5 }), rule: rule() });
    const result = await service.preview(orgId, { body: 'order?', provider: WHATSAPP });
    expect(result).toMatchObject({
      outcome: 'HANDOVER',
      handoverReason: 'LOW_CONFIDENCE',
      rule: null,
    });
  });

  it('skips a rule that does not cover the channel', async () => {
    const { service } = setup({
      ...options({}),
      rule: rule({ eligibleProviders: [EMAIL] }),
    });
    const result = await service.preview(orgId, { body: 'order?', provider: WHATSAPP });
    expect(result).toMatchObject({ outcome: 'HANDOVER', handoverReason: 'NO_AGENT' });
  });

  it('says so when the AI cannot read the message', async () => {
    const { service } = setup({ classification: null });
    await expect(
      service.preview(orgId, { body: 'hello', provider: WHATSAPP }),
    ).resolves.toMatchObject({ outcome: 'UNAVAILABLE', intent: null });
  });
});
