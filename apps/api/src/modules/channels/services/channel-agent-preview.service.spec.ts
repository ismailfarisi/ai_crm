import { ForbiddenException } from '@nestjs/common';
import { PERMISSIONS, type Permission } from '@saas/shared';
import { ChannelAgentPreviewService } from './channel-agent-preview.service';

const SUPPORT = {
  id: 'support',
  name: 'Support',
  description: 'Order questions',
  instructions: 'Be brief.',
  kind: 'CUSTOMER',
  skills: ['check_order_status'],
  channels: ['WHATSAPP_META'],
  isEnabled: true,
  model: null,
  provider: null,
};

const reply = (text: string, toolCalls: object[] = []) => ({
  text,
  toolCalls,
  raw: null,
  stopReason: null,
});

function setup() {
  const aiService = {
    generateStructured: jest.fn(),
    generateWithTools: jest
      .fn()
      .mockResolvedValueOnce(
        reply('', [{ id: 't1', name: 'check_order_status', input: {} }]),
      )
      .mockResolvedValueOnce(reply('SO-0007 is in production.')),
  };
  const senders = {
    asCustomer: jest.fn().mockResolvedValue({
      customerId: 'cust-a',
      companyName: 'Al Noor Sweets',
      via: 'LINKED',
    }),
    resolve: jest.fn(),
  };
  const lookup = {
    orders: jest
      .fn()
      .mockResolvedValue({ askedFor: null, found: true, records: [] }),
    quotes: jest.fn(),
  };
  const service = new ChannelAgentPreviewService(
    aiService as never,
    { findEnabled: jest.fn().mockResolvedValue([SUPPORT]) } as never,
    {} as never,
    {} as never,
    senders as never,
    lookup as never,
    { prices: jest.fn(), stockLevels: jest.fn() } as never,
  );
  const actor = (permissions: Permission[]) => ({
    organizationId: 'org',
    userId: 'user',
    permissions,
  });
  const message = {
    body: 'Where is my order?',
    provider: 'WHATSAPP_META' as const,
    kind: 'CUSTOMER' as const,
  };
  return { service, senders, lookup, actor, message };
}

const CAN_SEE_CUSTOMER_RECORDS = [
  PERMISSIONS.AI_MANAGE,
  PERMISSIONS.CUSTOMER_READ,
  PERMISSIONS.SALES_ORDER_READ,
  PERMISSIONS.QUOTE_READ,
];

describe('ChannelAgentPreviewService, trying a message as a customer', () => {
  it('treats the sender as a stranger when no customer is chosen', async () => {
    const { service, senders, lookup, actor, message } = setup();

    const result = await service.preview(
      actor([PERMISSIONS.AI_MANAGE]),
      message,
    );

    expect(senders.asCustomer).not.toHaveBeenCalled();
    expect(senders.resolve).not.toHaveBeenCalled();
    expect(lookup.orders).not.toHaveBeenCalled();
    expect(result.actions[0]).toContain('not matched to a customer');
  });

  it("reads the chosen customer's orders for someone allowed to see them", async () => {
    const { service, senders, lookup, actor, message } = setup();

    const result = await service.preview(actor(CAN_SEE_CUSTOMER_RECORDS), {
      ...message,
      asCustomerId: 'cust-a',
    });

    expect(senders.asCustomer).toHaveBeenCalledWith('org', 'cust-a');
    expect(lookup.orders).toHaveBeenCalledWith('org', 'cust-a', null);
    expect(result).toMatchObject({
      outcome: 'REPLY',
      reply: 'SO-0007 is in production.',
      actions: ['Look up orders for Al Noor Sweets'],
    });
  });

  it.each([
    PERMISSIONS.CUSTOMER_READ,
    PERMISSIONS.SALES_ORDER_READ,
    PERMISSIONS.QUOTE_READ,
  ])('refuses someone without %s, before anything is read', async (missing) => {
    const { service, senders, lookup, actor, message } = setup();

    await expect(
      service.preview(
        actor(CAN_SEE_CUSTOMER_RECORDS.filter((p) => p !== missing)),
        { ...message, asCustomerId: 'cust-a' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(senders.asCustomer).not.toHaveBeenCalled();
    expect(lookup.orders).not.toHaveBeenCalled();
  });
});
