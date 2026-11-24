import { BadRequestException } from '@nestjs/common';
import {
  AUTOMATION_LOOKUP_SAMPLES,
  AUTOMATION_NOTIFY_GROUPS,
  AUTOMATION_PERMISSIONS,
  PERMISSIONS,
} from '@saas/shared';
import { AI_CHAT_REFUSAL, createShopActions } from './shop-actions';
import type { AutomationActionContext } from './interfaces';
import { ChannelMessage } from '@/modules/channels/entities/channel-message.entity';
import { ChannelThread } from '@/modules/channels/entities/channel-thread.entity';
import { StaffChannelIdentity } from '@/modules/channels/entities/staff-channel-identity.entity';
import { User } from '@/modules/users/entities/user.entity';
import { Organization } from '@/modules/organizations/entities/organization.entity';
import { Quote } from '@/modules/quotes/entities/quote.entity';
import { QuoteProof } from '@/modules/quotes/entities/quote-proof.entity';
import { Invoice } from '@/modules/quotes/entities/invoice.entity';
import { InvoicePayment } from '@/modules/quotes/entities/invoice-payment.entity';
import { SalesOrder } from '@/modules/orders/entities/sales-order.entity';
import { WorkOrder } from '@/modules/production/entities/work-order.entity';
import { PurchaseOrder } from '@/modules/purchasing/entities/purchase-order.entity';
import { StockItem } from '@/modules/inventory/entities/stock-item.entity';

const TENANT = 'tenant-1';
const QUOTE_ID = '8a4c2d6e-91b3-4e0a-b7f4-0c5d3e2a1f90';

const ctx: AutomationActionContext = {
  tenantId: TENANT,
  workflowId: 'wf-1',
  workflowName: 'Job ready',
  executionId: 'exec-1',
  nodeId: 'node-1',
  ownerUserId: 'owner-1',
  aiWritten: false,
};

const ALL = [
  AUTOMATION_PERMISSIONS.AUTOMATION_EXECUTE,
  PERMISSIONS.CHANNEL_SEND,
  PERMISSIONS.CHANNEL_READ,
  PERMISSIONS.QUOTE_READ,
  PERMISSIONS.INVOICE_READ,
  PERMISSIONS.SALES_ORDER_READ,
  PERMISSIONS.WORK_ORDER_READ,
  PERMISSIONS.INVENTORY_READ,
  PERMISSIONS.PURCHASE_ORDER_READ,
];

interface Tables {
  users?: Partial<User>[];
  identities?: Partial<StaffChannelIdentity>[];
  inbound?: Partial<ChannelMessage> | null;
  quote?: Record<string, unknown> | null;
  proof?: Record<string, unknown> | null;
  invoice?: Record<string, unknown> | null;
}

function setup(tables: Tables = {}, permissions: string[] = ALL) {
  const finds: { entity: unknown; where: Record<string, unknown> }[] = [];
  const repo = (entity: unknown) => {
    const one = (): unknown => {
      if (entity === ChannelMessage) return tables.inbound ?? null;
      // Like the real column (select: false), the link's hash is never loaded.
      if (entity === Quote) {
        if (!tables.quote) return null;
        const loaded = { ...tables.quote };
        delete loaded.acceptanceTokenHash;
        return loaded;
      }
      if (entity === QuoteProof) return tables.proof ?? null;
      if (entity === Invoice) return tables.invoice ?? null;
      if (entity === Organization) return { id: TENANT, baseCurrency: 'AED' };
      return null;
    };
    const many = (): unknown[] => {
      if (entity === User) return tables.users ?? [];
      if (entity === StaffChannelIdentity) return tables.identities ?? [];
      if (entity === WorkOrder) {
        return [
          { id: 'wo-late', dueDate: new Date('2020-01-01') },
          { id: 'wo-today', dueDate: new Date() },
        ];
      }
      if (entity === Invoice) {
        return [
          {
            amount: '1000',
            paidAmount: '250',
            creditedAmount: 0,
            refundedAmount: 0,
          },
        ];
      }
      if (entity === StockItem) {
        return [
          { qtyOnHand: 1, qtyReserved: 0, qtyOnOrder: 0, reorderPoint: 5 },
          { qtyOnHand: 50, qtyReserved: 0, qtyOnOrder: 0, reorderPoint: 5 },
        ];
      }
      return [];
    };
    return {
      findOne: jest.fn((options: { where: Record<string, unknown> }) => {
        finds.push({ entity, where: options.where });
        return Promise.resolve(one());
      }),
      find: jest.fn((options: { where: Record<string, unknown> }) => {
        finds.push({ entity, where: options.where });
        return Promise.resolve(many());
      }),
      count: jest.fn((options: { where: Record<string, unknown> }) => {
        finds.push({ entity, where: options.where });
        if (entity === Quote && options.where.id) {
          return Promise.resolve(tables.quote?.acceptanceTokenHash ? 1 : 0);
        }
        if (entity === Quote) return Promise.resolve(4);
        if (entity === QuoteProof) return Promise.resolve(2);
        if (entity === SalesOrder) return Promise.resolve(6);
        if (entity === PurchaseOrder) return Promise.resolve(1);
        if (entity === ChannelThread) return Promise.resolve(3);
        return Promise.resolve(0);
      }),
      createQueryBuilder: () => {
        const builder = {
          select: () => builder,
          where: () => builder,
          andWhere: () => builder,
          getRawOne: () =>
            Promise.resolve(
              entity === InvoicePayment ? { sum: '9187.5' } : null,
            ),
        };
        return builder;
      },
    };
  };

  const channels = {
    sendMessage: jest.fn().mockResolvedValue({ id: 'msg-out-1' }),
  };
  const notifications = {
    notifyHolders: jest.fn().mockResolvedValue(3),
    notifyUsers: jest.fn().mockResolvedValue(1),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const ran = new Set<string>();
  const idempotency = {
    runOnce: jest.fn(
      async (_tenant: string, key: string, fn: () => Promise<unknown>) => {
        if (ran.has(key)) return { replayed: true };
        const result = await fn();
        ran.add(key);
        return result;
      },
    ),
  };
  const actions = createShopActions({
    dataSource: { getRepository: repo } as never,
    channels: channels,
    notifications: notifications,
    users: {
      findMember: jest.fn().mockResolvedValue({
        id: 'owner-1',
        tenantId: TENANT,
        email: 'owner@shop.ae',
        firstName: 'Omar',
        lastName: 'Owner',
        isActive: true,
      }),
      findActiveEmails: jest.fn(),
    },
    rbac: {
      resolveAccess: jest.fn().mockResolvedValue({ permissions, roles: [] }),
    },
    audit: audit,
    tenantContext: {
      runAsAutomation: (_t: string, _e: string, fn: () => unknown) => fn(),
    } as never,
    idempotency: idempotency as never,
  });
  return { actions, channels, notifications, audit, idempotency, finds };
}

describe('Send message step', () => {
  const toCustomer = {
    channel: 'WHATSAPP_META' as const,
    audience: 'customer' as const,
    to: '+971 50 123 4567',
    body: 'Your order SO-1 is ready to collect.',
  };

  it('sends the written text to a customer who has messaged the shop on that channel', async () => {
    const { actions, channels, audit, finds } = setup({
      inbound: { id: 'in-1', contactId: 'contact-1', createdAt: new Date() },
    });
    const result = await actions.executeChannelMessageActivity(toCustomer, ctx);

    expect(channels.sendMessage).toHaveBeenCalledWith(TENANT, 'owner-1', {
      provider: 'WHATSAPP_META',
      recipient: '971501234567',
      body: toCustomer.body,
      contactId: 'contact-1',
    });
    expect(result).toEqual({
      channel: 'WHATSAPP_META',
      audience: 'customer',
      sent: ['+971 50 123 4567'],
    });
    // The address is looked up inside this organisation, inbound only.
    expect(finds[0].where).toMatchObject({
      organizationId: TENANT,
      provider: 'WHATSAPP_META',
      direction: 'INBOUND',
      sender: '971501234567',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        action: 'automation.message.send',
        actorId: 'owner-1',
        subjectId: 'msg-out-1',
      }),
    );
  });

  it('refuses a customer who has never written on that channel', async () => {
    const { actions, channels } = setup({ inbound: null });
    await expect(
      actions.executeChannelMessageActivity(toCustomer, ctx),
    ).rejects.toMatchObject({
      nonRetryable: true,
      message: expect.stringContaining('has never messaged you on WhatsApp'),
    });
    expect(channels.sendMessage).not.toHaveBeenCalled();
  });

  it('refuses a customer whose last WhatsApp message is over 24 hours old', async () => {
    const { actions, channels } = setup({
      inbound: {
        id: 'in-1',
        contactId: 'contact-1',
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
    });
    await expect(
      actions.executeChannelMessageActivity(toCustomer, ctx),
    ).rejects.toMatchObject({
      nonRetryable: true,
      message: expect.stringContaining('more than 24 hours ago'),
    });
    expect(channels.sendMessage).not.toHaveBeenCalled();
  });

  it('never sends AI-written text to a customer', async () => {
    const { actions, channels } = setup({
      inbound: { id: 'in-1', contactId: 'contact-1', createdAt: new Date() },
    });
    await expect(
      actions.executeChannelMessageActivity(toCustomer, {
        ...ctx,
        aiWritten: true,
      }),
    ).rejects.toMatchObject({ nonRetryable: true, message: AI_CHAT_REFUSAL });
    expect(channels.sendMessage).not.toHaveBeenCalled();
  });

  it('sends AI-written text to staff, at the chat they linked', async () => {
    const { actions, channels } = setup({
      users: [{ id: 'user-2', email: 'floor@shop.ae' }],
      identities: [{ userId: 'user-2', identifier: '971509999999' }],
    });
    await actions.executeChannelMessageActivity(
      {
        channel: 'WHATSAPP_META',
        audience: 'staff',
        to: 'Floor@shop.ae',
        body: 'Deposit in for SO-1. Start the job.',
      },
      { ...ctx, aiWritten: true },
    );
    expect(channels.sendMessage).toHaveBeenCalledWith(TENANT, 'owner-1', {
      provider: 'WHATSAPP_META',
      recipient: '971509999999',
      body: 'Deposit in for SO-1. Start the job.',
    });
  });

  it('says who has not linked the channel instead of guessing an address', async () => {
    const { actions, channels } = setup({
      users: [{ id: 'user-2', email: 'floor@shop.ae' }],
      identities: [],
    });
    await expect(
      actions.executeChannelMessageActivity(
        {
          channel: 'TELEGRAM',
          audience: 'staff',
          to: 'floor@shop.ae',
          body: 'Hi',
        },
        ctx,
      ),
    ).rejects.toMatchObject({
      nonRetryable: true,
      message: expect.stringContaining(
        'floor@shop.ae has not linked Telegram to Kerf yet',
      ),
    });
    expect(channels.sendMessage).not.toHaveBeenCalled();
  });

  it('refuses a staff address outside the team', async () => {
    const { actions } = setup({ users: [] });
    await expect(
      actions.executeChannelMessageActivity(
        {
          channel: 'SLACK',
          audience: 'staff',
          to: 'someone@else.com',
          body: 'Hi',
        },
        ctx,
      ),
    ).rejects.toMatchObject({
      nonRetryable: true,
      message: expect.stringContaining('not an active member of your team'),
    });
  });

  it('posts to a Slack channel without a personal link', async () => {
    const { actions, channels } = setup();
    await actions.executeChannelMessageActivity(
      {
        channel: 'SLACK',
        audience: 'staff',
        to: 'C0123ABCD',
        body: 'Stock low',
      },
      ctx,
    );
    expect(channels.sendMessage).toHaveBeenCalledWith(TENANT, 'owner-1', {
      provider: 'SLACK',
      recipient: 'C0123ABCD',
      body: 'Stock low',
    });
  });

  it('does not send twice when the step is retried', async () => {
    const { actions, channels } = setup({
      inbound: { id: 'in-1', contactId: 'contact-1', createdAt: new Date() },
    });
    await actions.executeChannelMessageActivity(toCustomer, ctx);
    await actions.executeChannelMessageActivity(toCustomer, ctx);
    expect(channels.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('explains a channel that is not connected, without retrying', async () => {
    const { actions, channels } = setup({
      inbound: { id: 'in-1', contactId: 'contact-1', createdAt: new Date() },
    });
    channels.sendMessage.mockRejectedValue(
      new BadRequestException('Channel WHATSAPP_META is not configured'),
    );
    await expect(
      actions.executeChannelMessageActivity(toCustomer, ctx),
    ).rejects.toMatchObject({
      nonRetryable: true,
      message: expect.stringContaining('WhatsApp is not connected'),
    });
  });

  it('needs an owner who may send messages', async () => {
    const { actions } = setup({}, [AUTOMATION_PERMISSIONS.AUTOMATION_EXECUTE]);
    await expect(
      actions.executeChannelMessageActivity(toCustomer, ctx),
    ).rejects.toMatchObject({
      nonRetryable: true,
      message: expect.stringContaining(PERMISSIONS.CHANNEL_SEND),
    });
  });

  it('refuses email as a channel and an empty message', async () => {
    const { actions } = setup();
    await expect(
      actions.executeChannelMessageActivity(
        { ...toCustomer, channel: 'EMAIL_SMTP' as never },
        ctx,
      ),
    ).rejects.toMatchObject({ nonRetryable: true });
    await expect(
      actions.executeChannelMessageActivity({ ...toCustomer, body: '  ' }, ctx),
    ).rejects.toMatchObject({ message: 'Send message has no text to send' });
  });
});

describe('Notify staff step', () => {
  it.each(
    AUTOMATION_NOTIFY_GROUPS.map((group) => [group.value, group] as const),
  )('notifies the %s group by what its people can do', async (value, group) => {
    const { actions, notifications } = setup();
    const result = await actions.executeStaffNotificationActivity(
      {
        audience: 'group',
        group: value,
        title: 'Deposit paid for SO-1',
        body: 'The job can start.',
        link: '/production',
      },
      ctx,
    );
    expect(notifications.notifyHolders).toHaveBeenCalledWith(
      TENANT,
      group.permission,
      {
        type: 'AUTOMATION',
        title: 'Deposit paid for SO-1',
        body: 'The job can start.',
        link: '/production',
      },
      { refresh: true },
    );
    expect(result).toEqual({ notified: 3 });
  });

  // Kerf raises its own bell alert when stock runs low. The bell keeps one
  // unread alert per person, type and record, so filing the automation's
  // alert the same way leaves each buyer with one alert, not two.
  it('files an alert about low stock with the alert Kerf already raised for it', async () => {
    const { actions, notifications } = setup();
    const stockItemId = '7d0c1a52-3f0e-4c57-9a43-0d6a4b1f2c11';
    await actions.executeStaffNotificationActivity(
      { audience: 'group', group: 'purchasing', title: 'Running low: Board' },
      { ...ctx, startedBy: { eventType: 'stock.low', entityId: stockItemId } },
    );
    expect(notifications.notifyHolders).toHaveBeenCalledWith(
      TENANT,
      expect.anything(),
      expect.objectContaining({
        type: 'LOW_STOCK',
        entityType: 'STOCK_ITEM',
        entityId: stockItemId,
        title: 'Running low: Board',
      }),
      { refresh: true },
    );
  });

  it('files alerts about other events, and about a made-up test record, on their own', async () => {
    const { actions, notifications } = setup();
    const config = {
      audience: 'group' as const,
      group: 'production',
      title: 'Deposit paid',
    };
    await actions.executeStaffNotificationActivity(config, {
      ...ctx,
      startedBy: {
        eventType: 'deposit.paid',
        entityId: '7d0c1a52-3f0e-4c57-9a43-0d6a4b1f2c11',
      },
    });
    await actions.executeStaffNotificationActivity(config, {
      ...ctx,
      nodeId: 'notify-2',
      startedBy: { eventType: 'stock.low', entityId: 'not-a-record' },
    });
    for (const [, , input] of notifications.notifyHolders.mock.calls) {
      expect(input.type).toBe('AUTOMATION');
      expect(input.entityId).toBeUndefined();
    }
    expect(notifications.notifyHolders).toHaveBeenCalledTimes(2);
  });

  it('notifies named people, found inside the organisation', async () => {
    const { actions, notifications, finds } = setup({
      users: [{ id: 'user-2', email: 'buyer@shop.ae' }],
    });
    await actions.executeStaffNotificationActivity(
      { audience: 'person', to: 'buyer@shop.ae', title: 'Board is low' },
      ctx,
    );
    expect(finds[0].where).toMatchObject({ tenantId: TENANT, isActive: true });
    expect(notifications.notifyUsers).toHaveBeenCalledWith(
      TENANT,
      ['user-2'],
      expect.objectContaining({ type: 'AUTOMATION', title: 'Board is low' }),
    );
  });

  it('refuses a link that leaves the app, an unknown group and a missing title', async () => {
    const { actions, notifications } = setup();
    await expect(
      actions.executeStaffNotificationActivity(
        {
          audience: 'group',
          group: 'owners',
          title: 'Hi',
          link: 'https://evil.example',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ nonRetryable: true });
    await expect(
      actions.executeStaffNotificationActivity(
        {
          audience: 'group',
          group: 'owners',
          title: 'Hi',
          link: '//evil.example',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ nonRetryable: true });
    await expect(
      actions.executeStaffNotificationActivity(
        { audience: 'group', group: 'everyone', title: 'Hi' },
        ctx,
      ),
    ).rejects.toMatchObject({ nonRetryable: true });
    await expect(
      actions.executeStaffNotificationActivity(
        { audience: 'group', group: 'owners', title: ' ' },
        ctx,
      ),
    ).rejects.toMatchObject({ message: 'Notify staff has no title' });
    expect(notifications.notifyHolders).not.toHaveBeenCalled();
  });

  it('does not notify twice when the step is retried', async () => {
    const { actions, notifications } = setup();
    const config = { audience: 'group' as const, group: 'owners', title: 'Hi' };
    await actions.executeStaffNotificationActivity(config, ctx);
    await actions.executeStaffNotificationActivity(config, ctx);
    expect(notifications.notifyHolders).toHaveBeenCalledTimes(1);
  });
});

describe('Kerf record lookups', () => {
  const sentQuote = {
    id: QUOTE_ID,
    tenantId: TENANT,
    quoteNumber: 'Q-1',
    title: 'Cake boxes',
    customerName: 'Al Noor Bakery',
    customerEmail: 'orders@alnoorbakery.ae',
    totalAmount: '18375.00',
    currency: 'AED',
    status: 'APPROVED',
    acceptanceTokenHash: 'hash',
    acceptanceExpiresAt: null,
    acceptedAt: null,
    supersededAt: null,
    customerResponse: null,
    validUntil: null,
  };

  it('answers a test run about the invented sample quote, which is in no database', async () => {
    const invented = AUTOMATION_LOOKUP_SAMPLES.quote.quoteId;
    const config = {
      entity: 'quote',
      action: 'get',
      recordId: invented,
    } as const;

    const tested = await setup({}).actions.executeRecordLookupActivity(config, {
      ...ctx,
      testRun: true,
    });
    expect(tested).toEqual({
      ...AUTOMATION_LOOKUP_SAMPLES.quote,
      sampleRecord: true,
    });

    // A real run never gets invented details.
    await expect(
      setup({}).actions.executeRecordLookupActivity(config, ctx),
    ).rejects.toThrow(/that quote no longer exists/);
  });

  it('says a sent, unanswered quote is still waiting on the customer', async () => {
    const { actions, finds } = setup({ quote: sentQuote });
    const result = await actions.executeRecordLookupActivity(
      { entity: 'quote', action: 'get', recordId: QUOTE_ID },
      ctx,
    );
    expect(result.awaitingCustomer).toBe(true);
    expect(Object.keys(result).sort()).toEqual(
      Object.keys(AUTOMATION_LOOKUP_SAMPLES.quote).sort(),
    );
    expect(finds[0].where).toEqual({ id: QUOTE_ID, tenantId: TENANT });
    // "Was it sent" is its own tenant-scoped query: the hash is not loaded.
    expect(finds[1].where).toMatchObject({ id: QUOTE_ID, tenantId: TENANT });
    expect(finds[1].where).toHaveProperty('acceptanceTokenHash');
  });

  it.each([
    ['accepted', { acceptedAt: new Date() }],
    ['declined', { customerResponse: 'DECLINED' }],
    ['replaced by a revision', { supersededAt: new Date() }],
    ['never sent', { acceptanceTokenHash: null }],
    ['expired', { acceptanceExpiresAt: new Date('2020-01-01') }],
  ])('says a quote that was %s is not waiting', async (_name, patch) => {
    const { actions } = setup({ quote: { ...sentQuote, ...patch } });
    const result = await actions.executeRecordLookupActivity(
      { entity: 'quote', action: 'get', recordId: QUOTE_ID },
      ctx,
    );
    expect(result.awaitingCustomer).toBe(false);
  });

  it('says whether a proof still waits on the customer', async () => {
    const proof = {
      id: QUOTE_ID,
      quoteId: QUOTE_ID,
      version: 2,
      status: 'PENDING',
      supersededAt: null,
    };
    const waiting = await setup({
      proof,
      quote: sentQuote,
    }).actions.executeRecordLookupActivity(
      { entity: 'proof', action: 'get', recordId: QUOTE_ID },
      ctx,
    );
    expect(waiting.awaitingCustomer).toBe(true);
    expect(Object.keys(waiting).sort()).toEqual(
      Object.keys(AUTOMATION_LOOKUP_SAMPLES.proof).sort(),
    );
    const replaced = await setup({
      proof: { ...proof, supersededAt: new Date() },
      quote: sentQuote,
    }).actions.executeRecordLookupActivity(
      { entity: 'proof', action: 'get', recordId: QUOTE_ID },
      ctx,
    );
    expect(replaced.awaitingCustomer).toBe(false);
  });

  it('says whether an invoice is still unpaid', async () => {
    const { actions } = setup({
      invoice: {
        id: QUOTE_ID,
        invoiceNumber: 'INV-1',
        customerName: 'Al Noor Bakery',
        customerEmail: null,
        amount: '1000',
        paidAmount: '250',
        creditedAmount: 0,
        refundedAmount: 0,
        currency: 'AED',
        status: 'PARTIALLY_PAID',
        dueDate: new Date('2026-11-27'),
      },
    });
    const result = await actions.executeRecordLookupActivity(
      { entity: 'invoice', action: 'get', recordId: QUOTE_ID },
      ctx,
    );
    expect(result).toMatchObject({ balance: 750, unpaid: true });
    expect(Object.keys(result).sort()).toEqual(
      Object.keys(AUTOMATION_LOOKUP_SAMPLES.invoice).sort(),
    );
  });

  it('builds the daily summary from this organisation only', async () => {
    const { actions, finds } = setup();
    const result = await actions.executeRecordLookupActivity(
      { entity: 'summary', action: 'daily' },
      ctx,
    );
    expect(result).toMatchObject({
      quotesAwaitingCustomer: 4,
      proofsAwaitingCustomer: 2,
      ordersInProduction: 6,
      jobsDueToday: 1,
      jobsLate: 1,
      invoicesOverdue: 1,
      overdueAmount: 750,
      paymentsYesterday: 9187.5,
      currency: 'AED',
      stockItemsLow: 1,
      purchaseOrdersAwaitingApproval: 1,
      conversationsWaiting: 3,
    });
    expect(result.summaryText).toContain('Jobs due today: 1 (1 late)');
    expect(result.summaryText).toContain('Overdue invoices: 1 (AED 750.00)');
    expect(Object.keys(result).sort()).toEqual(
      Object.keys(AUTOMATION_LOOKUP_SAMPLES.summary).sort(),
    );
    for (const { entity, where } of finds) {
      const scope =
        entity === Organization
          ? where.id
          : (where.tenantId ?? where.organizationId);
      expect(scope).toBe(TENANT);
    }
  });

  it('leaves out of the summary what the owner may not see', async () => {
    const { actions } = setup({}, [AUTOMATION_PERMISSIONS.AUTOMATION_EXECUTE]);
    const result = await actions.executeRecordLookupActivity(
      { entity: 'summary', action: 'daily' },
      ctx,
    );
    expect(result).toMatchObject({
      quotesAwaitingCustomer: 0,
      ordersInProduction: 0,
      invoicesOverdue: 0,
      paymentsYesterday: 0,
      conversationsWaiting: 0,
    });
  });

  it('refuses a lookup the owner has no permission for, a bad id and a missing record', async () => {
    await expect(
      setup({ quote: sentQuote }, [
        AUTOMATION_PERMISSIONS.AUTOMATION_EXECUTE,
      ]).actions.executeRecordLookupActivity(
        { entity: 'quote', action: 'get', recordId: QUOTE_ID },
        ctx,
      ),
    ).rejects.toMatchObject({
      nonRetryable: true,
      message: expect.stringContaining(PERMISSIONS.QUOTE_READ),
    });
    await expect(
      setup().actions.executeRecordLookupActivity(
        { entity: 'quote', action: 'get', recordId: 'not-an-id' },
        ctx,
      ),
    ).rejects.toMatchObject({ nonRetryable: true });
    await expect(
      setup({ quote: null }).actions.executeRecordLookupActivity(
        { entity: 'quote', action: 'get', recordId: QUOTE_ID },
        ctx,
      ),
    ).rejects.toMatchObject({ nonRetryable: true });
  });
});
