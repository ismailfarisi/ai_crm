import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  CHANNEL_HANDOVER_REASON_LABELS,
  type ChannelHandoverReason,
  type ShopEventType,
} from '@saas/shared';
import { CrmEventBusService } from './crm-event-bus.service';
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

type Payload = Record<string, string | number | boolean | null>;

export interface ShopEventOptions {
  /** The caller's transaction: the event then commits, or rolls back, with the change. */
  manager?: EntityManager;
  actorUserId?: string | null;
  /** Facts only the caller knows (a payment amount, who answered). */
  extra?: Payload;
}

const CHANNEL_NAMES: Record<string, string> = {
  WHATSAPP_META: 'WhatsApp',
  TELEGRAM: 'Telegram',
  SLACK: 'Slack',
  EMAIL_SMTP: 'Email',
  EMAIL_RESEND: 'Email',
};

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Publishes the shop's own events (a job finished, a deposit was paid, stock
 * ran low) for automations to start from.
 *
 * Each payload is flat and built here, from the record as it stands, so every
 * event of a kind carries the same fields whichever screen, chat command or
 * webhook caused it. The field list is `SHOP_EVENTS` in `@saas/shared`: the
 * builder shows it, and a spec holds the two together.
 *
 * An event is never a reason for the change that caused it to fail: inside a
 * transaction the work runs under a savepoint, and every failure is logged
 * and swallowed.
 */
@Injectable()
export class ShopEventsService {
  private readonly logger = new Logger(ShopEventsService.name);

  constructor(
    private readonly bus: CrmEventBusService,
    private readonly dataSource: DataSource,
  ) {}

  async emit(
    eventType: ShopEventType,
    tenantId: string,
    entityId: string,
    options: ShopEventOptions = {},
  ): Promise<void> {
    const manager = options.manager ?? this.dataSource.manager;
    const savepoint = Boolean(options.manager);
    if (savepoint) await manager.query('SAVEPOINT shop_event');
    try {
      const payload = await this.payloadFor(
        manager,
        eventType,
        tenantId,
        entityId,
        options.extra ?? {},
      );
      if (payload) {
        await this.bus.publish(
          {
            tenantId,
            eventType,
            entityType: 'shop',
            entityName: eventType.split('.')[0],
            entityId,
            actorUserId: options.actorUserId ?? null,
            timestamp: new Date().toISOString(),
            snapshot: { before: null, after: payload, changedFields: [] },
          },
          options.manager ? { manager: options.manager } : {},
        );
      }
      if (savepoint) await manager.query('RELEASE SAVEPOINT shop_event');
    } catch (err) {
      if (savepoint) {
        await manager
          .query('ROLLBACK TO SAVEPOINT shop_event')
          .catch(() => undefined);
      }
      this.logger.warn(
        `Could not publish ${eventType} for ${entityId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Exposed for the contract spec; `null` when the record is gone. */
  async payloadFor(
    manager: EntityManager,
    eventType: ShopEventType,
    tenantId: string,
    entityId: string,
    extra: Payload = {},
  ): Promise<Payload | null> {
    const kind = eventType.split('.')[0];
    switch (kind) {
      case 'quote':
        return this.quotePayload(manager, eventType, tenantId, entityId, extra);
      case 'proof':
        return this.proofPayload(manager, eventType, tenantId, entityId);
      case 'sales_order':
        return this.orderPayload(manager, eventType, tenantId, entityId);
      case 'work_order':
        return this.workOrderPayload(manager, eventType, tenantId, entityId);
      case 'deposit':
      case 'payment':
        return this.paymentPayload(
          manager,
          eventType,
          tenantId,
          entityId,
          extra,
        );
      case 'purchase_order':
        return this.purchaseOrderPayload(manager, tenantId, entityId);
      case 'stock':
        return this.stockPayload(manager, tenantId, entityId);
      case 'expense':
        return this.expensePayload(manager, eventType, tenantId, entityId);
      case 'message':
        return this.messagePayload(manager, tenantId, entityId);
      case 'conversation':
        return this.handoverPayload(manager, tenantId, entityId);
      default:
        return null;
    }
  }

  private async customerFields(
    manager: EntityManager,
    tenantId: string,
    record: {
      customerId: string | null;
      customerName: string;
      customerEmail: string | null;
    },
  ): Promise<Payload> {
    const customer = record.customerId
      ? await manager
          .getRepository(Customer)
          .findOne({ where: { id: record.customerId, tenantId } })
      : null;
    return {
      customerId: record.customerId ?? null,
      customerName: record.customerName,
      customerEmail: record.customerEmail ?? customer?.email ?? null,
      customerPhone: customer?.phone ?? null,
    };
  }

  private async quoteFields(
    manager: EntityManager,
    tenantId: string,
    quote: Quote,
  ): Promise<Payload> {
    return {
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber ?? null,
      title: quote.title,
      ...(await this.customerFields(manager, tenantId, quote)),
      totalAmount: num(quote.totalAmount),
      currency: quote.currency,
    };
  }

  private async quotePayload(
    manager: EntityManager,
    eventType: ShopEventType,
    tenantId: string,
    quoteId: string,
    extra: Payload,
  ): Promise<Payload | null> {
    const quote = await manager
      .getRepository(Quote)
      .findOne({ where: { id: quoteId, tenantId } });
    if (!quote) return null;
    const base = await this.quoteFields(manager, tenantId, quote);
    if (eventType === 'quote.sent') {
      return {
        ...base,
        sentTo: extra.sentTo ?? quote.customerEmail ?? null,
        validUntil: iso(quote.validUntil),
      };
    }
    return {
      ...base,
      respondedByName: quote.customerRespondedByName ?? null,
      note: quote.customerResponseNote ?? null,
    };
  }

  private async proofPayload(
    manager: EntityManager,
    eventType: ShopEventType,
    tenantId: string,
    proofId: string,
  ): Promise<Payload | null> {
    const proof = await manager
      .getRepository(QuoteProof)
      .findOne({ where: { id: proofId, tenantId } });
    if (!proof) return null;
    const quote = await manager
      .getRepository(Quote)
      .findOne({ where: { id: proof.quoteId, tenantId } });
    if (!quote) return null;
    const base: Payload = {
      proofId: proof.id,
      proofVersion: proof.version,
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber ?? null,
      title: quote.title,
      ...(await this.customerFields(manager, tenantId, quote)),
      status: proof.status,
    };
    return eventType === 'proof.sent'
      ? { ...base, note: proof.staffNote ?? null }
      : {
          ...base,
          respondedByName: proof.respondedByName ?? null,
          comment: proof.responseComment ?? null,
        };
  }

  private async orderFields(
    manager: EntityManager,
    tenantId: string,
    order: SalesOrder,
  ): Promise<Payload> {
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      quoteNumber: order.quoteNumber ?? null,
      ...(await this.customerFields(manager, tenantId, order)),
      totalAmount: num(order.totalAmount),
      currency: order.currency,
    };
  }

  private async orderPayload(
    manager: EntityManager,
    eventType: ShopEventType,
    tenantId: string,
    orderId: string,
  ): Promise<Payload | null> {
    const order = await manager
      .getRepository(SalesOrder)
      .findOne({ where: { id: orderId, tenantId } });
    if (!order) return null;
    const base: Payload = {
      ...(await this.orderFields(manager, tenantId, order)),
      status: order.status,
    };
    if (eventType === 'sales_order.cancelled') {
      return { ...base, cancelReason: order.cancelReason ?? null };
    }
    if (eventType === 'sales_order.ready') {
      const jobsFinished = await manager.getRepository(WorkOrder).count({
        where: { tenantId, salesOrderId: order.id, status: 'COMPLETE' },
      });
      return { ...base, jobsFinished };
    }
    return base;
  }

  private async workOrderPayload(
    manager: EntityManager,
    eventType: ShopEventType,
    tenantId: string,
    workOrderId: string,
  ): Promise<Payload | null> {
    const wo = await manager
      .getRepository(WorkOrder)
      .findOne({ where: { id: workOrderId, tenantId } });
    if (!wo) return null;
    const order = wo.salesOrderId
      ? await manager
          .getRepository(SalesOrder)
          .findOne({ where: { id: wo.salesOrderId, tenantId } })
      : null;
    const customer: Payload = order
      ? await this.customerFields(manager, tenantId, order)
      : {
          customerId: null,
          customerName: null,
          customerEmail: null,
          customerPhone: null,
        };
    const base: Payload = {
      workOrderId: wo.id,
      workOrderNumber: wo.woNumber,
      description: wo.description,
      qty: num(wo.qty),
      qtyCompleted: num(wo.qtyCompleted),
      dueDate: iso(wo.dueDate),
      orderId: order?.id ?? null,
      orderNumber: order?.orderNumber ?? null,
      ...customer,
      status: wo.status,
    };
    return eventType === 'work_order.cancelled'
      ? { ...base, cancelReason: wo.cancelReason ?? null }
      : base;
  }

  private async paymentPayload(
    manager: EntityManager,
    eventType: ShopEventType,
    tenantId: string,
    invoiceId: string,
    extra: Payload,
  ): Promise<Payload | null> {
    const invoice = await manager
      .getRepository(Invoice)
      .findOne({ where: { id: invoiceId, tenantId } });
    if (!invoice) return null;
    const order = invoice.salesOrderId
      ? await manager
          .getRepository(SalesOrder)
          .findOne({ where: { id: invoice.salesOrderId, tenantId } })
      : null;
    const base: Payload = {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      stageLabel: invoice.stageLabel ?? null,
      ...(await this.customerFields(manager, tenantId, invoice)),
      amount: num(invoice.amount),
      paidAmount: num(invoice.paidAmount) ?? 0,
      currency: invoice.currency,
      dueDate: iso(invoice.dueDate),
      orderId: order?.id ?? null,
      orderNumber: order?.orderNumber ?? null,
      status: invoice.status,
    };
    const paidOnline = extra.paidOnline === true;
    return eventType === 'payment.received'
      ? { ...base, paymentAmount: num(extra.paymentAmount), paidOnline }
      : { ...base, paidOnline };
  }

  /** Whether this invoice is the deposit stage of its order. */
  async isDepositInvoice(
    manager: EntityManager,
    invoice: Pick<Invoice, 'billingScheduleLineId'>,
  ): Promise<boolean> {
    if (!invoice.billingScheduleLineId) return false;
    const stage = await manager
      .getRepository(BillingScheduleLine)
      .findOne({ where: { id: invoice.billingScheduleLineId } });
    return stage?.kind === 'DEPOSIT';
  }

  private async purchaseOrderPayload(
    manager: EntityManager,
    tenantId: string,
    orderId: string,
  ): Promise<Payload | null> {
    const po = await manager
      .getRepository(PurchaseOrder)
      .findOne({ where: { id: orderId, tenantId } });
    if (!po) return null;
    return {
      purchaseOrderId: po.id,
      poNumber: po.poNumber,
      supplierName: po.supplierName,
      totalAmount: num(po.totalAmount),
      currency: po.currency,
      expectedDate: iso(po.expectedDate),
      status: po.status,
    };
  }

  private async stockPayload(
    manager: EntityManager,
    tenantId: string,
    stockItemId: string,
  ): Promise<Payload | null> {
    const item = await manager
      .getRepository(StockItem)
      .findOne({ where: { id: stockItemId, tenantId } });
    if (!item) return null;
    const material = await manager
      .getRepository(Material)
      .findOne({ where: { id: item.materialId }, withDeleted: true });
    return {
      stockItemId: item.id,
      materialId: item.materialId,
      materialName: material?.name ?? 'A material',
      sku: material?.sku ?? null,
      unit: material?.uom ?? null,
      qtyOnHand: num(item.qtyOnHand),
      reorderPoint: num(item.reorderPoint),
      reorderQty: num(item.reorderQty),
    };
  }

  private async expensePayload(
    manager: EntityManager,
    eventType: ShopEventType,
    tenantId: string,
    expenseId: string,
  ): Promise<Payload | null> {
    const claim = await manager
      .getRepository(ExpenseClaim)
      .findOne({ where: { id: expenseId, tenantId } });
    if (!claim) return null;
    const base: Payload = {
      expenseId: claim.id,
      claimNumber: claim.claimNumber,
      employeeName: claim.employeeName,
      category: claim.category,
      merchantName: claim.merchantName ?? null,
      amount: num(claim.amount),
      currency: claim.currency,
      status: claim.status,
    };
    return eventType === 'expense.rejected'
      ? { ...base, rejectionReason: claim.rejectionReason ?? null }
      : base;
  }

  private async conversationFields(
    manager: EntityManager,
    tenantId: string,
    contactId: string | null,
    provider: string,
  ): Promise<Payload> {
    const contact = contactId
      ? await manager
          .getRepository(Contact)
          .findOne({ where: { id: contactId, tenantId } })
      : null;
    return {
      contactId: contactId ?? null,
      contactName: contact?.fullName || 'A customer',
      channel: CHANNEL_NAMES[provider] ?? provider,
      provider,
    };
  }

  private async messagePayload(
    manager: EntityManager,
    tenantId: string,
    messageId: string,
  ): Promise<Payload | null> {
    const message = await manager
      .getRepository(ChannelMessage)
      .findOne({ where: { id: messageId, organizationId: tenantId } });
    if (!message) return null;
    return {
      ...(await this.conversationFields(
        manager,
        tenantId,
        message.contactId,
        message.provider,
      )),
      messageId: message.id,
      from: message.sender,
      // The start of the message is enough to route on; the inbox has the rest.
      body: (message.body ?? '').slice(0, 1000),
    };
  }

  private async handoverPayload(
    manager: EntityManager,
    tenantId: string,
    threadId: string,
  ): Promise<Payload | null> {
    const thread = await manager
      .getRepository(ChannelThread)
      .findOne({ where: { id: threadId, organizationId: tenantId } });
    if (!thread) return null;
    const reason = thread.handoverReason as ChannelHandoverReason | null;
    return {
      ...(await this.conversationFields(
        manager,
        tenantId,
        thread.contactId,
        thread.provider,
      )),
      threadId: thread.id,
      reason: reason ?? null,
      reasonLabel: reason ? CHANNEL_HANDOVER_REASON_LABELS[reason] : null,
      summary: thread.handoverSummary ?? null,
    };
  }
}
