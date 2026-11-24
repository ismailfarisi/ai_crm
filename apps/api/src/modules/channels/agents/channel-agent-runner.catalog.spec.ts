import { ChannelAgentRunner } from './channel-agent-runner';
import type { ChannelAgent } from '../entities/channel-agent.entity';

/**
 * The price and stock tools, with the model played as an obedient accomplice
 * that calls them with whatever the test gives it (there is no AI key in
 * tests). What comes back may only ever be list prices and stock levels.
 */

const agent = (over: Partial<ChannelAgent> = {}): ChannelAgent =>
  ({
    id: 'sales',
    organizationId: 'org',
    name: 'Sales',
    description: 'Prices and stock',
    instructions: 'Be brief.',
    kind: 'CUSTOMER',
    provider: null,
    model: null,
    skills: ['check_price', 'check_stock'],
    channels: ['WHATSAPP_META'],
    isEnabled: true,
    showStockQuantity: false,
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

function setup(agents: ChannelAgent[] = [agent()]) {
  const aiService = {
    generateStructured: jest.fn(),
    generateWithTools: jest.fn(),
  };
  const senders = { resolve: jest.fn().mockResolvedValue(null) };
  const lookup = { orders: jest.fn(), quotes: jest.fn() };
  const catalog = {
    prices: jest.fn().mockResolvedValue({
      askedFor: 'flyers',
      found: true,
      records: [
        {
          name: 'A5 flyers (pack of 100)',
          sku: 'FLY-A5',
          unit: 'Pack',
          listPrice: 120,
          currency: 'AED',
          vatPercent: 5,
          leadTimeDays: 3,
        },
      ],
    }),
    stockLevels: jest.fn().mockResolvedValue({
      askedFor: 'acrylic',
      found: true,
      records: [{ name: 'Clear acrylic 3mm', unit: 'Sheet', level: 'LOW' }],
    }),
  };
  const runner = new ChannelAgentRunner({
    aiService: aiService as never,
    agents: { findEnabled: jest.fn().mockResolvedValue(agents) },
    senders,
    lookup,
    catalog,
  });
  const input = {
    organizationId: 'org',
    provider: 'WHATSAPP_META',
    contactId: 'c1',
    senderIdentifier: '971501234567',
    transcript: [{ role: 'customer' as const, body: 'How much are flyers?' }],
  };
  const toolResults = (): { content: string; isError?: boolean }[] =>
    aiService.generateWithTools.mock.calls[1][1].messages.at(-1).content;
  return { aiService, senders, lookup, catalog, runner, input, toolResults };
}

describe('ChannelAgentRunner price and stock tools', () => {
  it('offers the tools only to an agent the owner gave them to', async () => {
    const off = setup([agent({ skills: [] })]);
    off.aiService.generateWithTools.mockResolvedValue(text('Hello'));
    await off.runner.runCustomerTurn(off.input);
    const plain = off.aiService.generateWithTools.mock.calls[0][1];
    expect(plain.tools.map((t: { name: string }) => t.name)).toEqual([
      'hand_over_to_person',
    ]);
    expect(plain.system).toContain('you cannot look them up');

    const on = setup();
    on.aiService.generateWithTools.mockResolvedValue(text('Hello'));
    await on.runner.runCustomerTurn(on.input);
    const offered = on.aiService.generateWithTools.mock.calls[0][1];
    expect(offered.tools.map((t: { name: string }) => t.name)).toEqual([
      'hand_over_to_person',
      'check_price',
      'check_stock',
    ]);
    expect(offered.system).toContain('never say what any customer paid or was quoted');
  });

  it('refuses a price or stock call from an agent that was not given the tool', async () => {
    const { aiService, catalog, runner, input, toolResults } = setup([
      agent({ skills: [] }),
    ]);
    aiService.generateWithTools
      .mockResolvedValueOnce(calls({ name: 'check_price', input: { item: 'flyers' } }))
      .mockResolvedValueOnce(text('Let me check with the team.'));
    await runner.runCustomerTurn(input);
    expect(catalog.prices).not.toHaveBeenCalled();
    expect(toolResults()[0]).toMatchObject({
      content: 'That tool is not available.',
      isError: true,
    });
  });

  it('answers a price for anyone who writes, from the list price only', async () => {
    const { aiService, catalog, senders, lookup, runner, input, toolResults } = setup();
    aiService.generateWithTools
      .mockResolvedValueOnce(calls({ name: 'check_price', input: { item: 'flyers' } }))
      .mockResolvedValueOnce(text('A5 flyers are AED 120 per pack plus VAT.'));
    const result = await runner.runCustomerTurn(input);

    expect(result.outcome).toBe('REPLIED');
    expect(catalog.prices).toHaveBeenCalledWith('org', 'flyers');
    // A list price is not anyone's own record: the sender is not looked up,
    // and no quote or order is read.
    expect(senders.resolve).not.toHaveBeenCalled();
    expect(lookup.quotes).not.toHaveBeenCalled();
    expect(lookup.orders).not.toHaveBeenCalled();
    const content = toolResults()[0].content;
    expect(JSON.parse(content).records[0].listPrice).toBe(120);
    expect(content).not.toMatch(/cost|margin/i);
  });

  it('passes the owner\'s quantity setting to the stock lookup', async () => {
    const hidden = setup();
    hidden.aiService.generateWithTools
      .mockResolvedValueOnce(calls({ name: 'check_stock', input: { item: 'acrylic' } }))
      .mockResolvedValueOnce(text('It is running low.'));
    await hidden.runner.runCustomerTurn(hidden.input);
    expect(hidden.catalog.stockLevels).toHaveBeenCalledWith('org', 'acrylic', false);

    const shown = setup([agent({ showStockQuantity: true })]);
    shown.aiService.generateWithTools
      .mockResolvedValueOnce(calls({ name: 'check_stock', input: { item: 'acrylic' } }))
      .mockResolvedValueOnce(text('We have 4 sheets.'));
    await shown.runner.runCustomerTurn(shown.input);
    expect(shown.catalog.stockLevels).toHaveBeenCalledWith('org', 'acrylic', true);
  });

  it('tells the model not to guess when nothing matches, and the handover still works', async () => {
    const { aiService, catalog, runner, input, toolResults } = setup();
    catalog.prices.mockResolvedValue({ askedFor: 'neon sign', found: false, records: [] });
    aiService.generateWithTools
      .mockResolvedValueOnce(calls({ name: 'check_price', input: { item: 'neon sign' } }))
      .mockResolvedValueOnce(
        calls({
          name: 'hand_over_to_person',
          input: { reason: 'UNRESOLVED', summary: 'Wants a price for a neon sign.' },
        }),
      );
    const result = await runner.runCustomerTurn(input);
    expect(toolResults()[0].content).toContain('Do not guess');
    expect(result).toMatchObject({
      outcome: 'HANDOVER',
      handoverReason: 'UNRESOLVED',
      reply: null,
    });
  });

  it('refuses rather than guesses when the catalogue cannot be read', async () => {
    const aiService = { generateStructured: jest.fn(), generateWithTools: jest.fn() };
    const runner = new ChannelAgentRunner({
      aiService: aiService as never,
      agents: { findEnabled: jest.fn().mockResolvedValue([agent()]) },
    });
    aiService.generateWithTools
      .mockResolvedValueOnce(calls({ name: 'check_stock', input: { item: 'acrylic' } }))
      .mockResolvedValueOnce(text('Let me pass you to the team.'));
    await runner.runCustomerTurn(setup().input);
    const content = aiService.generateWithTools.mock.calls[1][1].messages.at(-1).content[0].content;
    expect(content).toContain('Hand the conversation to a person');
  });
});
