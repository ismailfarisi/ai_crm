import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import type {
  BillingScheduleLineDto,
  SalesOrderDto,
  SalesOrderStatus,
} from '@saas/shared';
import { LedgerService } from '../finance/ledger.service';
import { AutomationEventBridgeService } from '../automations/services/automation-event-bridge.service';
import { Invoice, InvoiceStatus } from '../quotes/entities/invoice.entity';
import { Quote } from '../quotes/entities/quote.entity';
import {
  BillingScheduleLine,
  SalesOrder,
  SalesOrderLine,
} from './entities/sales-order.entity';
import { raiseStageInvoice } from './order-provisioning';
import { ProductionService } from '../production/production.service';

/**
 * Where an order can go next. Invoicing is deliberately not tied to these:
 * a deposit is billed before production starts, and a balance can be billed
 * before delivery if that is what was agreed.
 */
const NEXT_STATUS: Record<SalesOrderStatus, SalesOrderStatus[]> = {
  OPEN: ['IN_PRODUCTION', 'FULFILLED'],
  IN_PRODUCTION: ['FULFILLED'],
  FULFILLED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(SalesOrder)
    private readonly orders: Repository<SalesOrder>,
    @InjectRepository(SalesOrderLine)
    private readonly lines: Repository<SalesOrderLine>,
    @InjectRepository(BillingScheduleLine)
    private readonly stages: Repository<BillingScheduleLine>,
    @InjectRepository(Invoice)
    private readonly invoices: Repository<Invoice>,
    @InjectRepository(Quote)
    private readonly quotes: Repository<Quote>,
    private readonly ledger: LedgerService,
    private readonly dataSource: DataSource,
    private readonly events: AutomationEventBridgeService,
    private readonly production: ProductionService,
  ) {}

  async list(
    tenantId: string,
    filter: { status?: SalesOrderStatus } = {},
  ): Promise<SalesOrderDto[]> {
    const orders = await this.orders.find({
      where: { tenantId, ...(filter.status ? { status: filter.status } : {}) },
      order: { createdAt: 'DESC' },
      take: 500,
    });
    if (!orders.length) return [];
    const ids = orders.map((o) => o.id);
    const [stages, invoices, quotes] = await Promise.all([
      this.stages.find({
        where: { salesOrderId: In(ids) },
        order: { sequence: 'ASC' },
      }),
      this.invoices.find({ where: { salesOrderId: In(ids) } }),
      this.quotes.find({ where: { id: In(orders.map((o) => o.quoteId)) } }),
    ]);
    return orders.map((order) =>
      this.toDto(
        order,
        [],
        stages.filter((s) => s.salesOrderId === order.id),
        invoices.filter((i) => i.salesOrderId === order.id),
        quotes.find((q) => q.id === order.quoteId) ?? null,
      ),
    );
  }

  async get(tenantId: string, id: string): Promise<SalesOrderDto> {
    const order = await this.findOrder(tenantId, id);
    const [lines, stages, invoices, quote] = await Promise.all([
      this.lines.find({
        where: { salesOrderId: order.id },
        order: { sequence: 'ASC' },
      }),
      this.stages.find({
        where: { salesOrderId: order.id },
        order: { sequence: 'ASC' },
      }),
      this.invoices.find({ where: { salesOrderId: order.id } }),
      this.quotes.findOne({ where: { id: order.quoteId } }),
    ]);
    return this.toDto(order, lines, stages, invoices, quote);
  }

  async findByQuote(
    tenantId: string,
    quoteId: string,
  ): Promise<SalesOrderDto | null> {
    const order = await this.orders.findOne({ where: { tenantId, quoteId } });
    return order ? this.get(tenantId, order.id) : null;
  }

  /** Raises the invoice for a milestone. Idempotent per stage. */
  async invoiceStage(
    tenantId: string,
    orderId: string,
    stageId: string,
  ): Promise<{ order: SalesOrderDto; invoiceId: string; isNew: boolean }> {
    const order = await this.findOrder(tenantId, orderId);
    const stage = await this.stages.findOne({
      where: { id: stageId, salesOrderId: order.id, tenantId },
    });
    if (!stage)
      throw new NotFoundException('Billing stage not found on this order');

    // Stages are billed in order. Skipping ahead would let the balance go out
    // before the deposit, which is never what anyone meant.
    const earlier = await this.stages.find({
      where: { salesOrderId: order.id },
      order: { sequence: 'ASC' },
    });
    const unbilledBefore = earlier.find(
      (s) => s.sequence < stage.sequence && !s.invoiceId,
    );
    if (unbilledBefore) {
      throw new BadRequestException(
        `Invoice "${unbilledBefore.label}" first. Stages are billed in order.`,
      );
    }

    const { invoice, isNew } = await raiseStageInvoice(
      this.dataSource,
      this.ledger,
      tenantId,
      stage.id,
    );

    if (isNew) {
      try {
        await this.events.handleCrmEvent({
          tenantId,
          eventType: 'invoice.issued',
          entityId: invoice.id,
          data: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            quoteId: order.quoteId,
            salesOrderId: order.id,
            stage: stage.label,
            amount: invoice.amount,
            dueDate: invoice.dueDate,
            customerId: invoice.customerId,
            customerEmail: invoice.customerEmail,
          },
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Failed to emit invoice.issued for ${invoice.id}: ${msg}`,
        );
      }
    }

    return {
      order: await this.get(tenantId, order.id),
      invoiceId: invoice.id,
      isNew,
    };
  }

  async setStatus(
    tenantId: string,
    id: string,
    status: SalesOrderStatus,
    actorId: string,
  ): Promise<SalesOrderDto> {
    const order = await this.findOrder(tenantId, id);
    if (status === 'CANCELLED') {
      throw new BadRequestException('Use cancel to cancel an order');
    }
    if (!NEXT_STATUS[order.status].includes(status)) {
      throw new BadRequestException(
        `${order.orderNumber} is ${label(order.status)} and cannot move to ${label(status)}`,
      );
    }
    if (status === 'CLOSED') {
      const stages = await this.stages.find({
        where: { salesOrderId: order.id },
      });
      // A per-delivery order has no stage invoice; it is billed once the
      // delivery that completed it has been invoiced.
      const unbilled = stages.filter(
        (s) => !s.invoiceId && !(s.trigger === 'ON_DELIVERY' && s.invoicedAt),
      );
      if (unbilled.length) {
        throw new BadRequestException(
          `${order.orderNumber} still has ${unbilled.length === 1 ? `"${unbilled[0].label}"` : `${unbilled.length} stages`} to invoice`,
        );
      }
    }
    /*
     * "Start production" used to flip a badge and raise nothing: the
     * Production page still read "No work orders", no job existed, nothing was
     * scheduled and no material was committed — while the order list told the
     * owner work had started on the floor.
     *
     * So it now starts production. Planning is idempotent (a line that already
     * has a live work order is skipped), and when nothing at all can be
     * planned the move is refused with the reason, rather than leaving a
     * status that claims something untrue.
     */
    if (status === 'IN_PRODUCTION') {
      const planned = await this.production.createFromSalesOrder(
        tenantId,
        actorId,
        order.id,
        { salesOrderLineIds: null, dueDate: null },
      );

      const alreadyRunning = await this.production.countLive(tenantId, order.id);

      if (planned.created.length === 0 && alreadyRunning === 0) {
        const reasons = [...new Set(planned.skipped.map((s) => s.reason))];
        throw new BadRequestException(
          `Nothing on ${order.orderNumber} can be made into a work order, so production cannot start. ${
            reasons.join('. ') || 'The order has no lines to plan.'
          }`,
        );
      }
    }

    if (status === 'FULFILLED') {
      const deliveries = await this.countDeliveries(order.id);
      if (deliveries > 0) {
        throw new BadRequestException(
          `${order.orderNumber} ships on delivery notes. Dispatch what is left instead of marking it fulfilled.`,
        );
      }
      await this.lines
        .createQueryBuilder()
        .update(SalesOrderLine)
        .set({ qtyFulfilled: () => 'qty_ordered' })
        .where('sales_order_id = :id', { id: order.id })
        .execute();
    }
    const updated = await this.orders
      .createQueryBuilder()
      .update(SalesOrder)
      .set({ status })
      .where('id = :id', { id: order.id })
      .andWhere('status = :from', { from: order.status })
      .execute();
    if (!updated.affected) {
      throw new BadRequestException(
        `${order.orderNumber} was changed by someone else. Reload and try again.`,
      );
    }
    return this.get(tenantId, order.id);
  }

  /**
   * Cancels an order nothing has been billed on. Once an invoice exists the
   * customer owes money on it, and unwinding that is a credit note, not a
   * cancellation.
   */
  async cancel(
    tenantId: string,
    id: string,
    reason: string | null,
  ): Promise<SalesOrderDto> {
    return this.dataSource
      .transaction(async (manager) => {
        const order = await manager
          .getRepository(SalesOrder)
          .createQueryBuilder('o')
          .setLock('pessimistic_write')
          .where('o.id = :id', { id })
          .andWhere('o.tenant_id = :tenantId', { tenantId })
          .getOne();
        if (!order) throw new NotFoundException('Sales order not found');
        if (order.status === 'CANCELLED') {
          throw new BadRequestException(
            `${order.orderNumber} is already cancelled`,
          );
        }
        const live = await manager.getRepository(Invoice).count({
          where: {
            salesOrderId: order.id,
            status: In([
              InvoiceStatus.ISSUED,
              InvoiceStatus.PARTIALLY_PAID,
              InvoiceStatus.PAID,
            ]),
          },
        });
        const shipped: unknown[] = await manager.query(
          `SELECT 1 FROM "delivery_notes" WHERE "sales_order_id" = $1 AND "status" = 'DISPATCHED' LIMIT 1`,
          [order.id],
        );
        if (shipped.length) {
          throw new BadRequestException(
            `${order.orderNumber} has shipped goods and cannot be cancelled.`,
          );
        }
        if (live > 0) {
          throw new BadRequestException(
            `${order.orderNumber} has been invoiced. Void its invoices first.`,
          );
        }
        order.status = 'CANCELLED';
        order.cancelledAt = new Date();
        order.cancelReason = reason;
        await manager.getRepository(SalesOrder).save(order);
        return order;
      })
      .then((order) => this.get(tenantId, order.id));
  }

  private async countDeliveries(salesOrderId: string): Promise<number> {
    const rows: { n: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS n FROM "delivery_notes" WHERE "sales_order_id" = $1 AND "status" <> 'CANCELLED'`,
      [salesOrderId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  private async findOrder(tenantId: string, id: string): Promise<SalesOrder> {
    const order = await this.orders.findOne({ where: { id, tenantId } });
    if (!order) throw new NotFoundException('Sales order not found');
    return order;
  }

  private toDto(
    order: SalesOrder,
    lines: SalesOrderLine[],
    stages: BillingScheduleLine[],
    invoices: Invoice[],
    quote: Quote | null,
  ): SalesOrderDto {
    const live = invoices.filter((i) => i.status !== InvoiceStatus.CANCELLED);
    const invoicedAmount =
      Math.round(live.reduce((sum, i) => sum + Number(i.amount) * 100, 0)) /
      100;
    const paidAmount =
      Math.round(
        live.reduce((sum, i) => sum + Number(i.paidAmount ?? 0) * 100, 0),
      ) / 100;
    const byId = new Map(invoices.map((i) => [i.id, i]));

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      quoteId: order.quoteId,
      quoteNumber: order.quoteNumber,
      customerId: order.customerId,
      customerName: order.customerName,
      status: order.status,
      currency: order.currency,
      subtotalAmount: order.subtotalAmount,
      discountAmount: order.discountAmount,
      taxAmount: order.taxAmount,
      totalAmount: order.totalAmount,
      invoicedAmount,
      paidAmount,
      acceptedAt: quote?.acceptedAt ? quote.acceptedAt.toISOString() : null,
      acceptedByName: quote?.acceptedByName ?? null,
      lines: lines.map((line) => ({
        id: line.id,
        description: line.description,
        uom: line.uom,
        qtyOrdered: line.qtyOrdered,
        qtyFulfilled: line.qtyFulfilled,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
      })),
      billingSchedule: stages.map((stage): BillingScheduleLineDto => {
        const invoice = stage.invoiceId ? byId.get(stage.invoiceId) : undefined;
        return {
          id: stage.id,
          sequence: stage.sequence,
          kind: stage.kind,
          label: stage.label,
          percent: stage.percent,
          trigger: stage.trigger,
          totalAmount: stage.totalAmount,
          invoiceId: stage.invoiceId,
          invoiceNumber: invoice?.invoiceNumber ?? null,
          invoiceStatus: invoice?.status ?? null,
          invoicedAt: stage.invoicedAt ? stage.invoicedAt.toISOString() : null,
        };
      }),
      createdAt: order.createdAt.toISOString(),
    };
  }
}

const label = (status: SalesOrderStatus) =>
  status.toLowerCase().replace('_', ' ');
