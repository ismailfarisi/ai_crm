import { SHOP_EVENTS, type ShopEventType } from '@saas/shared';
import type { DataSource, EntityManager } from 'typeorm';
import { ShopEventsService } from './shop-events.service';
import type { CrmEventBusService } from './crm-event-bus.service';
import { Quote } from '@/modules/quotes/entities/quote.entity';
import { QuoteProof } from '@/modules/quotes/entities/quote-proof.entity';
import { Invoice } from '@/modules/quotes/entities/invoice.entity';
import {
  BillingScheduleLine,
  SalesOrder,
} from '@/modules/orders/entities/sales-order.entity';
import { WorkOrder } from '@/modules/production/entities/work-order.entity';
import { PurchaseOrder } from '@/modules/purchasing/entities/purchase-order.entity';
import { StockItem } from '@/modules/inventory/entities/stock-item.entity';
import { Material } from '@/modules/catalog/entities/material.entity';
import { ExpenseClaim } from '@/modules/finance/entities/expense-claim.entity';
import { Customer } from '@/modules/customers/entities/customer.entity';
import { Contact } from '@/modules/contacts/entities/contact.entity';
import { ChannelThread } from '@/modules/channels/entities/channel-thread.entity';
import { ChannelMessage } from '@/modules/channels/entities/channel-message.entity';

const TENANT = 'tenant-1';

const customer = {
  customerId: 'cust-1',
  customerName: 'Al Noor Bakery',
  customerEmail: 'orders@alnoorbakery.ae',
};

/** One row per table, as the services would have left it. */
const rows = new Map<unknown, Record<string, unknown>>([
  [Customer, { id: 'cust-1', tenantId: TENANT, phone: '+971501234567' }],
  [
    Quote,
    {
      id: 'quote-1',
      tenantId: TENANT,
      quoteNumber: 'Q-1',
      title: 'Cake boxes',
      ...customer,
      totalAmount: '18375.00',
      currency: 'AED',
      validUntil: new Date('2026-12-04'),
      customerRespondedByName: 'Fatima',
      customerResponseNote: 'Fewer please',
    },
  ],
  [
    QuoteProof,
    {
      id: 'proof-1',
      tenantId: TENANT,
      quoteId: 'quote-1',
      version: 2,
      status: 'PENDING',
      staffNote: 'Logo moved',
      respondedByName: null,
      responseComment: null,
    },
  ],
  [
    SalesOrder,
    {
      id: 'order-1',
      tenantId: TENANT,
      orderNumber: 'SO-1',
      quoteNumber: 'Q-1',
      ...customer,
      totalAmount: '18375.00',
      currency: 'AED',
      status: 'IN_PRODUCTION',
      cancelReason: null,
    },
  ],
  [
    WorkOrder,
    {
      id: 'wo-1',
      tenantId: TENANT,
      woNumber: 'WO-1',
      description: 'Cake boxes',
      qty: '5000',
      qtyCompleted: '5000',
      dueDate: new Date('2026-12-02'),
      salesOrderId: 'order-1',
      status: 'COMPLETE',
      cancelReason: null,
    },
  ],
  [
    Invoice,
    {
      id: 'inv-1',
      tenantId: TENANT,
      invoiceNumber: 'INV-1',
      stageLabel: '50% deposit',
      ...customer,
      amount: '9187.50',
      paidAmount: '9187.50',
      currency: 'AED',
      dueDate: new Date('2026-11-27'),
      salesOrderId: 'order-1',
      billingScheduleLineId: 'stage-1',
      status: 'PAID',
    },
  ],
  [BillingScheduleLine, { id: 'stage-1', kind: 'DEPOSIT' }],
  [
    PurchaseOrder,
    {
      id: 'po-1',
      tenantId: TENANT,
      poNumber: 'PO-1',
      supplierName: 'Gulf Paper',
      totalAmount: '6420.00',
      currency: 'AED',
      expectedDate: new Date('2026-11-25'),
      status: 'RECEIVED',
    },
  ],
  [
    StockItem,
    {
      id: 'stock-1',
      tenantId: TENANT,
      materialId: 'mat-1',
      qtyOnHand: '120',
      reorderPoint: '200',
      reorderQty: '1000',
    },
  ],
  [Material, { id: 'mat-1', name: 'White board', sku: 'BRD', uom: 'SHEET' }],
  [
    ExpenseClaim,
    {
      id: 'exp-1',
      tenantId: TENANT,
      claimNumber: 'EXP-1',
      employeeName: 'Rashid',
      category: 'Fuel',
      merchantName: 'ENOC',
      amount: '180.00',
      currency: 'AED',
      status: 'SUBMITTED',
      rejectionReason: null,
    },
  ],
  [Contact, { id: 'contact-1', tenantId: TENANT, fullName: 'Fatima' }],
  [
    ChannelMessage,
    {
      id: 'msg-1',
      organizationId: TENANT,
      contactId: 'contact-1',
      provider: 'WHATSAPP_META',
      sender: '+971501234567',
      body: 'Is my order ready?',
    },
  ],
  [
    ChannelThread,
    {
      id: 'thread-1',
      organizationId: TENANT,
      contactId: 'contact-1',
      provider: 'WHATSAPP_META',
      handoverReason: 'HUMAN_REQUESTED',
      handoverSummary: 'Wants a new delivery date',
    },
  ],
]);

const ENTITY_ID: Record<string, string> = {
  quote: 'quote-1',
  proof: 'proof-1',
  sales_order: 'order-1',
  work_order: 'wo-1',
  deposit: 'inv-1',
  payment: 'inv-1',
  purchase_order: 'po-1',
  stock: 'stock-1',
  expense: 'exp-1',
  message: 'msg-1',
  conversation: 'thread-1',
};

/** Emitted by InvoicesService on the older path, not by this service. */
const LEGACY = new Set([
  'invoice.paid',
  'invoice.partially_paid',
  'invoice.voided',
]);

function makeManager(overrides: Partial<EntityManager> = {}) {
  const wheres: { entity: unknown; where: Record<string, unknown> }[] = [];
  const manager = {
    query: jest.fn().mockResolvedValue(undefined),
    getRepository: (entity: unknown) => ({
      findOne: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        wheres.push({ entity, where });
        return Promise.resolve(rows.get(entity) ?? null);
      }),
      count: jest.fn().mockResolvedValue(2),
    }),
    ...overrides,
  } as unknown as EntityManager;
  return { manager, wheres };
}

function makeService(manager: EntityManager) {
  const bus = { publish: jest.fn().mockResolvedValue(undefined) };
  const service = new ShopEventsService(
    bus as unknown as CrmEventBusService,
    { manager } as unknown as DataSource,
  );
  return { service, bus };
}

describe('ShopEventsService', () => {
  const published = SHOP_EVENTS.filter((event) => !LEGACY.has(event.value));

  it.each(published.map((event) => [event.value, event] as const))(
    '%s carries exactly the fields the builder shows for it',
    async (value, definition) => {
      const { manager } = makeManager();
      const { service } = makeService(manager);
      const payload = await service.payloadFor(
        manager,
        value as ShopEventType,
        TENANT,
        ENTITY_ID[value.split('.')[0]],
        {
          sentTo: 'orders@alnoorbakery.ae',
          paymentAmount: 100,
          paidOnline: true,
        },
      );
      expect(payload).not.toBeNull();
      expect(Object.keys(payload!).sort()).toEqual(
        Object.keys(definition.sample).sort(),
      );
    },
  );

  it('reads every tenant-owned record with the tenant in the query', async () => {
    const { manager, wheres } = makeManager();
    const { service } = makeService(manager);
    for (const event of published) {
      await service.payloadFor(
        manager,
        event.value as ShopEventType,
        TENANT,
        ENTITY_ID[event.value.split('.')[0]],
      );
    }
    const unscoped = wheres.filter(
      ({ entity, where }) =>
        // A billing stage and a material are reached only through a row
        // that was itself read by tenant.
        entity !== BillingScheduleLine &&
        entity !== Material &&
        where.tenantId !== TENANT &&
        where.organizationId !== TENANT,
    );
    expect(unscoped).toEqual([]);
  });

  it('publishes the payload as the event snapshot, in the caller’s transaction', async () => {
    const { manager } = makeManager();
    const { service, bus } = makeService(manager);
    await service.emit('work_order.completed', TENANT, 'wo-1', {
      manager,
      actorUserId: 'user-1',
    });
    expect(bus.publish).toHaveBeenCalledTimes(1);
    const [event, options] = bus.publish.mock.calls[0];
    expect(event).toMatchObject({
      tenantId: TENANT,
      eventType: 'work_order.completed',
      entityName: 'work_order',
      entityId: 'wo-1',
      actorUserId: 'user-1',
    });
    expect(event.snapshot.after).toMatchObject({
      workOrderNumber: 'WO-1',
      orderNumber: 'SO-1',
      customerPhone: '+971501234567',
      qty: 5000,
    });
    expect(options).toEqual({ manager });
    expect((manager.query as jest.Mock).mock.calls.map((c) => c[0])).toEqual([
      'SAVEPOINT shop_event',
      'RELEASE SAVEPOINT shop_event',
    ]);
  });

  it('never fails the change that caused the event', async () => {
    const { manager } = makeManager();
    const { service, bus } = makeService(manager);
    bus.publish.mockRejectedValue(new Error('outbox down'));
    await expect(
      service.emit('stock.low', TENANT, 'stock-1', { manager }),
    ).resolves.toBeUndefined();
    expect((manager.query as jest.Mock).mock.calls.map((c) => c[0])).toEqual([
      'SAVEPOINT shop_event',
      'ROLLBACK TO SAVEPOINT shop_event',
    ]);
  });

  it('publishes nothing for a record that is gone', async () => {
    const { manager } = makeManager({
      getRepository: (() => ({
        findOne: jest.fn().mockResolvedValue(null),
      })) as never,
    });
    const { service, bus } = makeService(manager);
    await service.emit('quote.sent', TENANT, 'missing');
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it('knows a deposit invoice by its billing stage', async () => {
    const { manager } = makeManager();
    const { service } = makeService(manager);
    await expect(
      service.isDepositInvoice(manager, { billingScheduleLineId: 'stage-1' }),
    ).resolves.toBe(true);
    await expect(
      service.isDepositInvoice(manager, { billingScheduleLineId: null }),
    ).resolves.toBe(false);
  });
});
