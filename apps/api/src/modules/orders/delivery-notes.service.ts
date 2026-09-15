import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Not, Repository } from 'typeorm';
import {
  calculateQuoteTotals,
  LEDGER_ROLES,
  remainingToDeliver,
  scaleBreakdown,
  type CreateDeliveryNotePayload,
  type DeliveryNoteDto,
  type QuoteLineItem,
} from '@saas/shared';
import {
  allocateNextSequenceValue,
  formatSequenceNumber,
} from '@/database/tenant-sequence.util';
import { CatalogItem } from '../catalog/entities/catalog-item.entity';
import {
  DeliveryNote,
  DeliveryNoteLine,
} from '../credits/entities/credit-note.entity';
import { LedgerService } from '../finance/ledger.service';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { InventoryService } from '../inventory/inventory.service';
import { Invoice, InvoiceStatus } from '../quotes/entities/invoice.entity';
import { Quote } from '../quotes/entities/quote.entity';
import {
  BillingScheduleLine,
  SalesOrder,
  SalesOrderLine,
} from './entities/sales-order.entity';
import { breakdownForItems, issueInvoice } from './order-provisioning';

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100);
const round2 = (n: number) => cents(n) / 100;
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/**
 * What shipped, and when.
 *
 * A delivery note is prepared as a draft and dispatched when the van leaves.
 * Dispatch is where it counts: it advances each order line's fulfilled
 * quantity, and takes goods sold from stock off the shelf at the moving
 * average, posting Dr COGS / Cr Inventory. Made-to-order goods are not on the
 * shelf — their cost reached COGS when their work order completed — so a
 * line with no stocked material moves no stock.
 */
@Injectable()
export class DeliveryNotesService {
  constructor(
    @InjectRepository(DeliveryNote)
    private readonly notes: Repository<DeliveryNote>,
    @InjectRepository(DeliveryNoteLine)
    private readonly lines: Repository<DeliveryNoteLine>,
    @InjectRepository(SalesOrder)
    private readonly orders: Repository<SalesOrder>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    private readonly inventory: InventoryService,
    private readonly ledger: LedgerService,
    private readonly dataSource: DataSource,
  ) {}

  async listForOrder(
    tenantId: string,
    salesOrderId: string,
  ): Promise<DeliveryNoteDto[]> {
    const rows = await this.notes.find({
      where: { tenantId, salesOrderId },
      order: { createdAt: 'ASC' },
    });
    return this.toDtos(tenantId, rows);
  }

  async get(tenantId: string, id: string): Promise<DeliveryNoteDto> {
    const row = await this.notes.findOne({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Delivery note not found');
    return (await this.toDtos(tenantId, [row]))[0];
  }

  /** Detail for the packing slip, including the lines as stored. */
  async forPdf(tenantId: string, id: string) {
    const note = await this.notes.findOne({ where: { id, tenantId } });
    if (!note) throw new NotFoundException('Delivery note not found');
    const [lines, order] = await Promise.all([
      this.lines.find({ where: { deliveryNoteId: id } }),
      this.orders.findOne({ where: { id: note.salesOrderId, tenantId } }),
    ]);
    return { note, lines, order };
  }

  async create(
    tenantId: string,
    actorId: string,
    salesOrderId: string,
    input: CreateDeliveryNotePayload,
  ): Promise<DeliveryNoteDto> {
    const saved = await this.dataSource.transaction(async (manager) => {
      const order = await this.lockOrder(manager, tenantId, salesOrderId);
      if (order.status === 'CANCELLED' || order.status === 'CLOSED') {
        throw new BadRequestException(
          `${order.orderNumber} is ${order.status.toLowerCase()} and cannot ship`,
        );
      }

      const orderLines = await manager.getRepository(SalesOrderLine).find({
        where: { salesOrderId: order.id, tenantId },
      });
      const drafts = await this.draftQuantities(manager, order.id);
      const catalogIds = orderLines
        .map((l) => l.catalogItemId)
        .filter((v): v is string => Boolean(v));
      const catalog = catalogIds.length
        ? await manager
            .getRepository(CatalogItem)
            .find({ where: { tenantId, id: In(catalogIds) } })
        : [];

      const seen = new Set<string>();
      for (const requested of input.lines) {
        if (seen.has(requested.salesOrderLineId)) {
          throw new BadRequestException(
            'Each order line can appear once on a delivery',
          );
        }
        seen.add(requested.salesOrderLineId);
        const line = orderLines.find(
          (l) => l.id === requested.salesOrderLineId,
        );
        if (!line)
          throw new NotFoundException('That line is not on this order');
        const remaining = remainingToDeliver({
          qtyOrdered: line.qtyOrdered,
          qtyFulfilled: line.qtyFulfilled,
          qtyInDraft: drafts.get(line.id) ?? 0,
        });
        if (requested.qty > remaining + 1e-9) {
          throw new BadRequestException(
            `Only ${remaining} of "${line.description}" is left to ship${drafts.get(line.id) ? ' once other draft deliveries are counted' : ''}`,
          );
        }
      }

      const number = await allocateNextSequenceValue(
        manager,
        tenantId,
        'delivery_note_number',
      );
      const noteRepo = manager.getRepository(DeliveryNote);
      const note = await noteRepo.save(
        noteRepo.create({
          tenantId,
          deliveryNoteNumber: formatSequenceNumber('DN', number),
          status: 'DRAFT',
          salesOrderId: order.id,
          customerName: order.customerName,
          shipTo: input.shipTo,
          carrier: input.carrier,
          trackingReference: input.trackingReference,
          notes: input.notes,
          createdById: actorId,
        }),
      );
      const lineRepo = manager.getRepository(DeliveryNoteLine);
      await lineRepo.save(
        input.lines.map((requested) => {
          const line = orderLines.find(
            (l) => l.id === requested.salesOrderLineId,
          )!;
          return lineRepo.create({
            tenantId,
            deliveryNoteId: note.id,
            salesOrderLineId: line.id,
            description: line.description,
            uom: line.uom,
            qty: requested.qty,
            stockMaterialId:
              catalog.find((c) => c.id === line.catalogItemId)
                ?.stockMaterialId ?? null,
          });
        }),
      );
      return note;
    });
    return this.get(tenantId, saved.id);
  }

  /**
   * Ships it. Re-checks quantities against the locked order lines, because a
   * second delivery may have been dispatched since this one was drafted.
   */
  async dispatch(
    tenantId: string,
    id: string,
    actorId: string,
  ): Promise<DeliveryNoteDto> {
    await this.dataSource.transaction(async (manager) => {
      const note = await this.lockNote(manager, tenantId, id);
      if (note.status !== 'DRAFT') {
        throw new ConflictException(
          `${note.deliveryNoteNumber} is already ${note.status.toLowerCase()}`,
        );
      }
      const order = await this.lockOrder(manager, tenantId, note.salesOrderId);
      if (order.status === 'CANCELLED' || order.status === 'CLOSED') {
        throw new BadRequestException(
          `${order.orderNumber} is ${order.status.toLowerCase()}`,
        );
      }

      const lines = await manager.getRepository(DeliveryNoteLine).find({
        where: { deliveryNoteId: note.id },
      });
      const orderLines = await manager
        .getRepository(SalesOrderLine)
        .createQueryBuilder('l')
        .setLock('pessimistic_write')
        .where('l.sales_order_id = :orderId', { orderId: order.id })
        .getMany();

      let cogs = 0;
      for (const line of lines) {
        const orderLine = orderLines.find(
          (l) => l.id === line.salesOrderLineId,
        );
        if (!orderLine)
          throw new NotFoundException(
            'An order line on this delivery no longer exists',
          );
        const left = round4(orderLine.qtyOrdered - orderLine.qtyFulfilled);
        if (line.qty > left + 1e-9) {
          throw new BadRequestException(
            `Only ${left} of "${orderLine.description}" is left to ship`,
          );
        }
        if (line.stockMaterialId) {
          const { movement, value } = await this.inventory.issueForDelivery(
            manager,
            {
              tenantId,
              materialId: line.stockMaterialId,
              qty: line.qty,
              deliveryNoteId: note.id,
              deliveryNoteNumber: note.deliveryNoteNumber,
              actorId,
            },
          );
          line.stockMovementId = movement.id;
          cogs = round2(cogs + value);
          await manager.getRepository(DeliveryNoteLine).save(line);
        }
        orderLine.qtyFulfilled = round4(orderLine.qtyFulfilled + line.qty);
      }
      await manager.getRepository(SalesOrderLine).save(orderLines);

      if (cogs > 0) {
        const description = `${note.deliveryNoteNumber} dispatched`;
        const entries = manager.getRepository(JournalEntry);
        await entries.save(
          entries.create({
            tenantId,
            entryNumber: `JE-${note.deliveryNoteNumber}`,
            referenceType: 'STOCK',
            referenceId: note.id,
            entryDate: new Date(),
            totalAmount: cogs,
            lines: await this.ledger.resolveLines(
              tenantId,
              [
                {
                  role: LEDGER_ROLES.COGS,
                  accountName: 'Cost of goods sold',
                  debit: cogs,
                  credit: 0,
                  description,
                },
                {
                  role: LEDGER_ROLES.INVENTORY,
                  accountName: 'Inventory',
                  debit: 0,
                  credit: cogs,
                  description,
                },
              ],
              manager,
            ),
          }),
        );
      }

      note.status = 'DISPATCHED';
      note.dispatchedAt = new Date();
      note.dispatchedById = actorId;
      await manager.getRepository(DeliveryNote).save(note);

      const everythingShipped = orderLines.every(
        (l) => l.qtyFulfilled + 1e-9 >= l.qtyOrdered,
      );
      if (
        everythingShipped &&
        (order.status === 'OPEN' || order.status === 'IN_PRODUCTION')
      ) {
        order.status = 'FULFILLED';
        await manager.getRepository(SalesOrder).save(order);
      }
    });
    return this.get(tenantId, id);
  }

  async cancel(tenantId: string, id: string): Promise<DeliveryNoteDto> {
    await this.dataSource.transaction(async (manager) => {
      const note = await this.lockNote(manager, tenantId, id);
      if (note.status !== 'DRAFT') {
        throw new ConflictException(
          note.status === 'DISPATCHED'
            ? `${note.deliveryNoteNumber} has shipped. Goods coming back are a return, not a cancellation.`
            : `${note.deliveryNoteNumber} is already cancelled`,
        );
      }
      note.status = 'CANCELLED';
      note.cancelledAt = new Date();
      await manager.getRepository(DeliveryNote).save(note);
    });
    return this.get(tenantId, id);
  }

  /**
   * Invoices exactly what one delivery carried, at the quoted price, discount
   * and tax of each line.
   *
   * Only for orders whose billing schedule says "invoice each delivery":
   * mixing this with percentage stages would bill the same goods twice. The
   * delivery that completes the order is invoiced for whatever of the order
   * total remains, so rounding across several part-invoices can never leave a
   * cent unbilled or bill one extra.
   */
  async invoice(
    tenantId: string,
    id: string,
  ): Promise<{ delivery: DeliveryNoteDto; invoiceId: string }> {
    const invoiceId = await this.dataSource.transaction(async (manager) => {
      const note = await this.lockNote(manager, tenantId, id);
      if (note.status !== 'DISPATCHED') {
        throw new BadRequestException(
          'Only a dispatched delivery can be invoiced',
        );
      }
      const existing = await manager.getRepository(Invoice).findOne({
        where: {
          deliveryNoteId: note.id,
          status: Not(InvoiceStatus.CANCELLED),
        },
      });
      if (existing) return existing.id;

      const order = await this.lockOrder(manager, tenantId, note.salesOrderId);
      const stages = await manager.getRepository(BillingScheduleLine).find({
        where: { salesOrderId: order.id },
      });
      const perDelivery =
        stages.length === 1 && stages[0].trigger === 'ON_DELIVERY';
      if (!perDelivery) {
        throw new BadRequestException(
          `${order.orderNumber} is billed by its billing schedule, not per delivery`,
        );
      }

      const [lines, orderLines, quote, earlier] = await Promise.all([
        manager
          .getRepository(DeliveryNoteLine)
          .find({ where: { deliveryNoteId: note.id } }),
        manager
          .getRepository(SalesOrderLine)
          .find({ where: { salesOrderId: order.id } }),
        manager
          .getRepository(Quote)
          .findOne({ where: { id: order.quoteId, tenantId } }),
        manager.getRepository(Invoice).find({
          where: {
            salesOrderId: order.id,
            status: Not(InvoiceStatus.CANCELLED),
          },
        }),
      ]);
      const quoteItems = new Map((quote?.items ?? []).map((i) => [i.id, i]));

      const items: QuoteLineItem[] = lines.map((line) => {
        const orderLine = orderLines.find(
          (l) => l.id === line.salesOrderLineId,
        )!;
        const quoted = orderLine.quoteLineId
          ? quoteItems.get(orderLine.quoteLineId)
          : undefined;
        const discount = Number(quoted?.discount) || 0;
        const net = round2(
          line.qty * orderLine.unitPrice * (1 - discount / 100),
        );
        return {
          id: `dn-${line.id}`,
          type: 'product',
          description: line.description,
          quantity: line.qty,
          uom: line.uom ?? undefined,
          unitPrice: orderLine.unitPrice,
          discount,
          taxRate: Number(quoted?.taxRate) || 0,
          taxCodeId: quoted?.taxCodeId ?? null,
          taxCode: quoted?.taxCode ?? null,
          taxReverseCharge: quoted?.taxReverseCharge ?? false,
          subtotal: net,
        };
      });

      let totals = calculateQuoteTotals(items);
      const invoicedNet =
        earlier.reduce((s, i) => s + cents(i.subtotalAmount), 0) / 100;
      const invoicedTax =
        earlier.reduce((s, i) => s + cents(i.taxAmount), 0) / 100;
      const remainingNet = round2(order.subtotalAmount - invoicedNet);
      const remainingTax = round2(order.taxAmount - invoicedTax);

      const everythingShipped = orderLines.every(
        (l) => l.qtyFulfilled + 1e-9 >= l.qtyOrdered,
      );
      const otherUninvoiced = await manager
        .getRepository(DeliveryNote)
        .createQueryBuilder('d')
        .where('d.sales_order_id = :orderId', { orderId: order.id })
        .andWhere(`d.status = 'DISPATCHED'`)
        .andWhere('d.id <> :id', { id: note.id })
        .andWhere(
          `NOT EXISTS (SELECT 1 FROM "invoices" i WHERE i."delivery_note_id" = d.id AND i."status" <> 'CANCELLED')`,
        )
        .getCount();
      const completesOrder = everythingShipped && otherUninvoiced === 0;
      const overshoots =
        cents(totals.subtotalAmount) > cents(remainingNet) ||
        cents(totals.taxAmount) > cents(remainingTax);

      if (completesOrder || overshoots) {
        if (!(remainingNet + remainingTax > 0)) {
          throw new BadRequestException(
            `${order.orderNumber} has already been invoiced in full`,
          );
        }
        totals = {
          ...totals,
          subtotalAmount: remainingNet,
          taxAmount: remainingTax,
          totalAmount: round2(remainingNet + remainingTax),
        };
      }

      const invoice = await issueInvoice(manager, this.ledger, tenantId, {
        order,
        items,
        subtotalAmount: totals.subtotalAmount,
        discountAmount: totals.discountAmount,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        taxBreakdown: scaleBreakdown(breakdownForItems(items), {
          net: totals.subtotalAmount,
          tax: totals.taxAmount,
        }),
        billingScheduleLineId: null,
        deliveryNoteId: note.id,
        stageLabel: `Delivery ${note.deliveryNoteNumber}`,
        notes: quote?.notes ?? null,
      });

      if (completesOrder) {
        stages[0].invoicedAt = new Date();
        await manager.getRepository(BillingScheduleLine).save(stages[0]);
      }
      return invoice.id;
    });
    return { delivery: await this.get(tenantId, id), invoiceId };
  }

  /* ------------------------------------------------------------------ */

  private async draftQuantities(
    manager: EntityManager,
    salesOrderId: string,
  ): Promise<Map<string, number>> {
    const rows: { lineId: string; qty: string }[] = await manager.query(
      `SELECT l."sales_order_line_id" AS "lineId", SUM(l."qty") AS qty
       FROM "delivery_note_lines" l
       JOIN "delivery_notes" d ON d."id" = l."delivery_note_id"
       WHERE d."sales_order_id" = $1 AND d."status" = 'DRAFT'
       GROUP BY l."sales_order_line_id"`,
      [salesOrderId],
    );
    return new Map(rows.map((r) => [r.lineId, Number(r.qty)]));
  }

  private async lockOrder(
    manager: EntityManager,
    tenantId: string,
    id: string,
  ): Promise<SalesOrder> {
    const order = await manager
      .getRepository(SalesOrder)
      .createQueryBuilder('o')
      .setLock('pessimistic_write')
      .where('o.id = :id', { id })
      .andWhere('o.tenant_id = :tenantId', { tenantId })
      .getOne();
    if (!order) throw new NotFoundException('Sales order not found');
    return order;
  }

  private async lockNote(
    manager: EntityManager,
    tenantId: string,
    id: string,
  ): Promise<DeliveryNote> {
    const note = await manager
      .getRepository(DeliveryNote)
      .createQueryBuilder('d')
      .setLock('pessimistic_write')
      .where('d.id = :id', { id })
      .andWhere('d.tenant_id = :tenantId', { tenantId })
      .getOne();
    if (!note) throw new NotFoundException('Delivery note not found');
    return note;
  }

  private async toDtos(
    tenantId: string,
    rows: DeliveryNote[],
  ): Promise<DeliveryNoteDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [lines, orders, invoices] = await Promise.all([
      this.lines.find({ where: { deliveryNoteId: In(ids) } }),
      this.orders.find({
        where: {
          tenantId,
          id: In([...new Set(rows.map((r) => r.salesOrderId))]),
        },
      }),
      this.invoices.find({
        where: {
          tenantId,
          deliveryNoteId: In(ids),
          status: Not(InvoiceStatus.CANCELLED),
        },
      }),
    ]);
    return rows.map((row) => {
      const invoice = invoices.find((i) => i.deliveryNoteId === row.id);
      return {
        id: row.id,
        deliveryNoteNumber: row.deliveryNoteNumber,
        status: row.status,
        salesOrderId: row.salesOrderId,
        orderNumber:
          orders.find((o) => o.id === row.salesOrderId)?.orderNumber ?? '',
        customerName: row.customerName,
        shipTo: row.shipTo,
        carrier: row.carrier,
        trackingReference: row.trackingReference,
        notes: row.notes,
        lines: lines
          .filter((l) => l.deliveryNoteId === row.id)
          .map((l) => ({
            id: l.id,
            salesOrderLineId: l.salesOrderLineId,
            description: l.description,
            uom: l.uom,
            qty: l.qty,
            stockMaterialId: l.stockMaterialId,
          })),
        invoiceId: invoice?.id ?? null,
        invoiceNumber: invoice?.invoiceNumber ?? null,
        dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}
