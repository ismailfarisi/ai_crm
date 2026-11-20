import { ChannelAgentRunner } from './channel-agent-runner';
import type { ChannelAgent } from '../entities/channel-agent.entity';

const agent = (over: Partial<ChannelAgent>): ChannelAgent =>
  ({
    id: over.name ?? 'a',
    organizationId: 'org',
    name: 'Sales',
    description: 'New enquiries and quotes',
    instructions: 'Be brief.',
    kind: 'CUSTOMER',
    provider: null,
    model: null,
    skills: [],
    channels: ['WHATSAPP_META'],
    isEnabled: true,
    ...over,
  }) as ChannelAgent;

const text = (value: string) => ({
  text: value,
  toolCalls: [],
  raw: { provider: 'test', content: null },
  usage: { inputTokens: 0, outputTokens: 0 },
  model: 'm',
  stopReason: null,
});
const calls = (
  ...toolCalls: { name: string; input: Record<string, unknown> }[]
) => ({
  ...text(''),
  toolCalls: toolCalls.map((call, i) => ({ id: `t${i}`, ...call })),
});

function setup(agents: ChannelAgent[], threadAgentId: string | null = null) {
  const aiService = {
    generateStructured: jest.fn(),
    generateWithTools: jest.fn(),
  };
  const threads = {
    getOrCreate: jest
      .fn()
      .mockResolvedValue({ id: 'thread', agentId: threadAgentId }),
    setAgent: jest.fn(),
  };
  const quotesService = {
    createQuote: jest.fn().mockResolvedValue({ id: 'q1' }),
  };
  const runner = new ChannelAgentRunner({
    aiService: aiService as never,
    agents: { findEnabled: jest.fn().mockResolvedValue(agents) },
    threads: threads,
    quotesService: quotesService,
  });
  const input = {
    organizationId: 'org',
    provider: 'WHATSAPP_META',
    contactId: 'c1',
    senderIdentifier: '+971500000000',
    transcript: [{ role: 'customer' as const, body: 'I need 500 boxes' }],
  };
  return { aiService, threads, quotesService, runner, input };
}

describe('ChannelAgentRunner', () => {
  it('takes no part when no agent answers on the channel', async () => {
    const { runner, input, aiService } = setup([]);
    const result = await runner.runCustomerTurn(input);
    expect(result.outcome).toBe('NO_AGENT');
    expect(aiService.generateWithTools).not.toHaveBeenCalled();
  });

  it('gives a single agent the message without a routing call, on its own model', async () => {
    const sales = agent({
      name: 'Sales',
      model: 'big-model',
      provider: 'OPENAI',
    });
    const { runner, input, aiService, threads } = setup([sales]);
    aiService.generateWithTools.mockResolvedValue(
      text('What size are the boxes?'),
    );

    const result = await runner.runCustomerTurn(input);

    expect(result).toMatchObject({
      outcome: 'REPLIED',
      reply: 'What size are the boxes?',
      agent: { id: 'Sales', name: 'Sales' },
    });
    expect(aiService.generateStructured).not.toHaveBeenCalled();
    const [feature, options] = aiService.generateWithTools.mock.calls[0];
    expect(feature).toBe('channels.customer_agent');
    expect(options.model).toBe('big-model');
    expect(options.provider).toBe('OPENAI');
    expect(options.system).toContain('Be brief.');
    expect(threads.setAgent).toHaveBeenCalledWith('org', 'thread', 'Sales');
  });

  it('routes between several agents by description, and falls back when none fits', async () => {
    const all = [agent({ name: 'Sales' }), agent({ name: 'Support' })];
    const { runner, input, aiService } = setup(all);
    aiService.generateStructured.mockResolvedValue({
      data: { agent: 'Support', confidence: 0.9 },
    });
    aiService.generateWithTools.mockResolvedValue(text('Sorry to hear that.'));
    expect((await runner.runCustomerTurn(input)).agent?.name).toBe('Support');

    aiService.generateStructured.mockResolvedValue({
      data: { agent: 'Support', confidence: 0.3 },
    });
    expect((await runner.runCustomerTurn(input)).outcome).toBe('NO_AGENT');
  });

  it('keeps a conversation with the agent that already holds it', async () => {
    const all = [agent({ name: 'Sales' }), agent({ name: 'Support' })];
    const { runner, input, aiService, threads } = setup(all, 'Support');
    aiService.generateWithTools.mockResolvedValue(text('Still here.'));

    const result = await runner.runCustomerTurn(input);

    expect(result.agent?.name).toBe('Support');
    expect(aiService.generateStructured).not.toHaveBeenCalled();
    expect(threads.setAgent).not.toHaveBeenCalled();
  });

  it('passes the conversation to another agent with the reason and summary', async () => {
    const all = [agent({ name: 'Sales' }), agent({ name: 'Support' })];
    const { runner, input, aiService, threads } = setup(all, 'Sales');
    aiService.generateWithTools
      .mockResolvedValueOnce(
        calls({
          name: 'transfer_to_agent',
          input: {
            agent: 'Support',
            reason: 'A delivery problem',
            summary: 'Box arrived damaged',
          },
        }),
      )
      .mockResolvedValueOnce(text('We will sort that out.'));

    const result = await runner.runCustomerTurn(input);

    expect(result.outcome).toBe('REPLIED');
    expect(result.agent?.name).toBe('Support');
    expect(result.transfers).toEqual([
      { from: 'Sales', to: 'Support', reason: 'A delivery problem' },
    ]);
    const second = aiService.generateWithTools.mock.calls[1][1];
    expect(second.system).toContain('"Support" agent');
    expect(JSON.stringify(second.messages)).toContain('Box arrived damaged');
    expect(threads.setAgent).toHaveBeenCalledWith('org', 'thread', 'Support');
  });

  it('hands over to a person when the agent asks to', async () => {
    const { runner, input, aiService } = setup([agent({ name: 'Sales' })]);
    aiService.generateWithTools.mockResolvedValue(
      calls({
        name: 'hand_over_to_person',
        input: { reason: 'COMPLAINT', summary: 'Unhappy about a late order' },
      }),
    );

    expect(await runner.runCustomerTurn(input)).toMatchObject({
      outcome: 'HANDOVER',
      handoverReason: 'COMPLAINT',
      handoverSummary: 'Unhappy about a late order',
      reply: null,
    });
  });

  it('hands over rather than looping when agents keep passing a message around', async () => {
    const all = [agent({ name: 'Sales' }), agent({ name: 'Support' })];
    const { runner, input, aiService } = setup(all, 'Sales');
    aiService.generateWithTools.mockImplementation((_f, options) =>
      Promise.resolve(
        calls({
          name: 'transfer_to_agent',
          input: {
            agent: options.system.includes('"Sales" agent')
              ? 'Support'
              : 'Sales',
            reason: 'not mine',
            summary: 's',
          },
        }),
      ),
    );

    const result = await runner.runCustomerTurn(input);

    expect(result.outcome).toBe('HANDOVER');
    expect(result.handoverReason).toBe('UNRESOLVED');
    expect(result.transfers).toHaveLength(3);
  });

  it('drafts a quote only for an agent given that tool, and only once', async () => {
    const sales = agent({ name: 'Sales', skills: ['draft_quote'] });
    const { runner, input, aiService, quotesService } = setup([sales]);
    const draft = calls({
      name: 'draft_quote',
      input: { title: '500 boxes', request: '500 rigid boxes' },
    });
    aiService.generateWithTools
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(text('The team will send your quote shortly.'));

    const result = await runner.runCustomerTurn(input);

    expect(result.createdQuoteId).toBe('q1');
    expect(quotesService.createQuote).toHaveBeenCalledTimes(1);
    expect(quotesService.createQuote).toHaveBeenCalledWith(
      'org',
      expect.objectContaining({ prompt: '500 rigid boxes', createdBy: 'AI' }),
    );
    const offered = aiService.generateWithTools.mock.calls[0][1].tools.map(
      (tool: { name: string }) => tool.name,
    );
    expect(offered).toEqual(['hand_over_to_person', 'draft_quote']);
  });

  it('refuses a tool the agent was not given', async () => {
    const { runner, input, aiService, quotesService } = setup([
      agent({ name: 'Sales' }),
    ]);
    aiService.generateWithTools
      .mockResolvedValueOnce(
        calls({ name: 'draft_quote', input: { title: 't', request: 'r' } }),
      )
      .mockResolvedValueOnce(text('Someone will be in touch.'));

    await runner.runCustomerTurn(input);

    expect(quotesService.createQuote).not.toHaveBeenCalled();
    const followUp = aiService.generateWithTools.mock.calls[1][1].messages;
    expect(JSON.stringify(followUp)).toContain('not available');
  });

  it('does nothing for real on a dry run', async () => {
    const sales = agent({ name: 'Sales', skills: ['draft_quote'] });
    const { runner, input, aiService, quotesService, threads } = setup([sales]);
    aiService.generateWithTools
      .mockResolvedValueOnce(
        calls({
          name: 'draft_quote',
          input: { title: 't', request: '500 boxes' },
        }),
      )
      .mockResolvedValueOnce(text('The team will send your quote shortly.'));

    const result = await runner.runCustomerTurn({ ...input, dryRun: true });

    expect(result.actions).toEqual([
      'Draft a quote for staff to review: 500 boxes',
    ]);
    expect(quotesService.createQuote).not.toHaveBeenCalled();
    expect(threads.getOrCreate).not.toHaveBeenCalled();
    expect(threads.setAgent).not.toHaveBeenCalled();
  });
});
