import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import {
  applyIssue,
  applyReceipt,
  isReceiptWithinTolerance,
  LEDGER_ROLES,
  needsReorder,
  PERMISSIONS,
  replayMovements,
  roundCost,
  toBase,
  type StockMovementType,
  type StockReferenceType,
} from '@saas/shared';
import {
  allocateNextSequenceValue,
  formatSequenceNumber,
} from '@/database/tenant-sequence.util';
import { LedgerService } from '../finance/ledger.service';
import { fxRateFor } from '../finance/fx';
import { NotificationsService } from '../notifications/notifications.service';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { PurchaseOrder } from '../purchasing/entities/purchase-order.entity';
import { PurchaseOrderLine } from '../purchasing/entities/purchase-order-line.entity';
import { PurchasePolicyEntity } from '../purchasing/entities/purchase-policy.entity';
import {
  GoodsReceipt,
  GoodsReceiptLine,
} from './entities/goods-receipt.entity';
import { StockItem } from './entities/stock-item.entity';
import { StockLocation } from './entities/stock-location.entity';
import { StockMovement } from './entities/stock-movement.entity';

/** A stock row with everything needed to display it. */
/** Money to the cent, matching how bills clear GRNI line by line. */
const money = (n: number): number =>
  Math.round((n + Number.EPSILON) * 100) / 100;

export interface StockItemView {
  id: string;
  materialId: string;
  materialName: string;
  materialSku: string | null;
  uom: string;
  locationId: string;
  locationName: string;
  qtyOnHand: number;
  qtyReserved: number;
  qtyOnOrder: number;
  avgUnitCost: number;
  reorderPoint: number | null;
  reorderQty: number | null;
}

export interface ReceiveLineInput {
  purchaseOrderLineId: string;
  qtyReceived: number;
  qtyRejected?: number;
}

export interface ReceiveInput {
  locationId?: string;
  supplierReference?: string | null;
  notes?: string | null;
  lines: ReceiveLineInput[];
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(StockItem)
    private readonly stockItems: Repository<StockItem>,
    @InjectRepository(StockMovement)
    private readonly movements: Repository<StockMovement>,
    @InjectRepository(StockLocation)
    private readonly locations: Repository<StockLocation>,
    @InjectRepository(GoodsReceipt)
    private readonly receipts: Repository<GoodsReceipt>,
    @InjectRepository(PurchaseOrder)
    private readonly orders: Repository<PurchaseOrder>,
    @InjectRepository(PurchasePolicyEntity)
    private readonly policies: Repository<PurchasePolicyEntity>,
    private readonly ledger: LedgerService,
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  /* ------------------------------------------------------------------ *
   * Locations
   * ------------------------------------------------------------------ */

  /**
   * The tenant's default location, created on first use.
   *
   * Most shops have exactly one and will never think about this; the row
   * exists so that a second one later does not require deciding what every
   * historic quantity referred to.
   */
  async ensureDefaultLocation(
    tenantId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<StockLocation> {
    const repo = manager.getRepository(StockLocation);
    const existing = await repo.findOne({
      where: { tenantId, isDefault: true, deletedAt: IsNull() },
    });
    if (existing) return existing;

    return repo.save(
      repo.create({ tenantId, name: 'Main store', isDefault: true }),
    );
  }

  async listLocations(tenantId: string): Promise<StockLocation[]> {
    return this.locations.find({
      where: { tenantId, deletedAt: IsNull() },
      order: { isDefault: 'DESC', name: 'ASC' },
    });
  }

  /* ------------------------------------------------------------------ *
   * Stock positions
   * ------------------------------------------------------------------ */

  async listStock(tenantId: string): Promise<StockItem[]> {
    return this.stockItems.find({
      where: { tenantId },
      order: { materialId: 'ASC' },
    });
  }

  /**
   * Stock with the material's name and unit attached.
   *
   * Denormalised into the response rather than left to the caller, because the
   * obvious alternative - having the browser fetch the catalog - needs
   * `catalog:manage`, which someone holding only `inventory:read` will not
   * have. A stock row reading "mat-1: 500" helps nobody on a stock take.
   */
  async listStockView(tenantId: string): Promise<StockItemView[]> {
    const rows: Array<Record<string, string | number | null>> =
      await this.stockItems
        .createQueryBuilder('item')
        .leftJoin('catalog_materials', 'm', 'm.id = item.material_id')
        .leftJoin('stock_locations', 'l', 'l.id = item.location_id')
        .select([
          'item.id AS id',
          'item.material_id AS "materialId"',
          'item.location_id AS "locationId"',
          'item.qty_on_hand AS "qtyOnHand"',
          'item.qty_reserved AS "qtyReserved"',
          'item.qty_on_order AS "qtyOnOrder"',
          'item.avg_unit_cost AS "avgUnitCost"',
          'item.reorder_point AS "reorderPoint"',
          'item.reorder_qty AS "reorderQty"',
          'm.name AS "materialName"',
          'm.sku AS "materialSku"',
          'm.uom AS "uom"',
          'l.name AS "locationName"',
        ])
        .where('item.tenant_id = :tenantId', { tenantId })
        .orderBy('m.name', 'ASC')
        .getRawMany();

    // `getRawMany` hands back numerics as strings; the transformers that
    // normally do this only run on mapped entities.
    return rows.map((row) => ({
      id: String(row.id),
      materialId: String(row.materialId),
      materialName: (row.materialName as string) ?? 'Unknown material',
      materialSku: (row.materialSku as string) ?? null,
      uom: (row.uom as string) ?? '',
      locationId: String(row.locationId),
      locationName: (row.locationName as string) ?? '',
      qtyOnHand: Number(row.qtyOnHand ?? 0),
      qtyReserved: Number(row.qtyReserved ?? 0),
      qtyOnOrder: Number(row.qtyOnOrder ?? 0),
      avgUnitCost: Number(row.avgUnitCost ?? 0),
      reorderPoint: row.reorderPoint == null ? null : Number(row.reorderPoint),
      reorderQty: row.reorderQty == null ? null : Number(row.reorderQty),
    }));
  }

  /**
   * Materials at or below their reorder point.
   *
   * `qtyOnOrder` is part of the calculation, so an outstanding purchase order
   * does not produce a second one for the same shortage.
   */
  async reorderSuggestions(
    tenantId: string,
  ): Promise<
    { item: StockItemView; shortfall: number; suggestedQty: number }[]
  > {
    // The view, not the raw row: a suggestion that cannot name the material is
    // not actionable.
    const items = await this.listStockView(tenantId);
    return items
      .filter((item) => needsReorder(item))
      .map((item) => {
        const available = item.qtyOnHand - item.qtyReserved + item.qtyOnOrder;
        const point = item.reorderPoint ?? 0;
        return {
          item,
          shortfall: roundCost(point - available),
          suggestedQty: item.reorderQty ?? roundCost(point - available),
        };
      });
  }

  /**
   * Replays the movement ledger and compares it to the cached position.
   *
   * `stock_items` is a projection; this is what proves the two still agree. A
   * divergence means something wrote a quantity without recording why.
   */
  async reconcile(tenantId: string): Promise<
    {
      materialId: string;
      locationId: string;
      cached: number;
      replayed: number;
    }[]
  > {
    const [items, movements] = await Promise.all([
      this.listStock(tenantId),
      this.movements.find({ where: { tenantId }, order: { createdAt: 'ASC' } }),
    ]);

    const divergences: {
      materialId: string;
      locationId: string;
      cached: number;
      replayed: number;
    }[] = [];

    for (const item of items) {
      const relevant = movements.filter(
        (m) =>
          m.materialId === item.materialId && m.locationId === item.locationId,
      );
      const replayed = replayMovements(relevant);
      if (replayed.qtyOnHand !== item.qtyOnHand) {
        divergences.push({
          materialId: item.materialId,
          locationId: item.locationId,
          cached: item.qtyOnHand,
          replayed: replayed.qtyOnHand,
        });
      }
    }
    return divergences;
  }

  /**
   * Moves quantity between "on order" and "on hand" as a purchase order
   * progresses.
   *
   * Counted from approval rather than from sending: approval is the point at
   * which the organisation has committed to buying, and therefore the point
   * from which a shortage has already been dealt with. Without this the
   * reorder check double-counts — it would suggest ordering board that is
   * already on its way.
   *
   * Quantities land on the default location because a purchase order does not
   * name one; the receipt that follows may well put it somewhere else, at
   * which point the on-order figure is released regardless of destination.
   */
  async adjustOnOrder(
    tenantId: string,
    lines: { materialId: string | null; qty: number }[],
    manager: EntityManager = this.dataSource.manager,
  ): Promise<void> {
    const relevant = lines.filter((l) => l.materialId && l.qty !== 0);
    if (relevant.length === 0) return;

    const location = await this.ensureDefaultLocation(tenantId, manager);

    for (const line of relevant) {
      await manager.query(
        `INSERT INTO "stock_items" ("tenant_id", "material_id", "location_id", "qty_on_order")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ("tenant_id", "material_id", "location_id")
         DO UPDATE SET "qty_on_order" = GREATEST(
           0,
           "stock_items"."qty_on_order" + $4
         )`,
        [tenantId, line.materialId, location.id, line.qty],
      );
    }
  }

  /**
   * Sets the reorder point and quantity for a material.
   *
   * Without these the reorder check can never fire, so the suggestion endpoint
   * would always come back empty however low stock ran.
   */
  async setReorderLevels(
    tenantId: string,
    materialId: string,
    input: {
      reorderPoint: number | null;
      reorderQty: number | null;
      locationId?: string;
    },
  ): Promise<StockItem> {
    const location = input.locationId
      ? await this.locations.findOne({
          where: { id: input.locationId, tenantId, deletedAt: IsNull() },
        })
      : await this.ensureDefaultLocation(tenantId);
    if (!location) throw new NotFoundException('Stock location not found');

    await this.stockItems.query(
      `INSERT INTO "stock_items" ("tenant_id", "material_id", "location_id")
       VALUES ($1, $2, $3)
       ON CONFLICT ("tenant_id", "material_id", "location_id") DO NOTHING`,
      [tenantId, materialId, location.id],
    );

    const item = await this.stockItems.findOne({
      where: { tenantId, materialId, locationId: location.id },
    });
    if (!item) throw new NotFoundException('Stock position not found');

    item.reorderPoint = input.reorderPoint;
    item.reorderQty = input.reorderQty;
    return this.stockItems.save(item);
  }

  /* ------------------------------------------------------------------ *
   * The one place stock changes
   * ------------------------------------------------------------------ */

  /**
   * Applies one movement: locks the position, folds in the arithmetic, writes
   * the ledger row, updates the projection.
   *
   * The lock is the whole point. Two deliveries of the same board arriving at
   * once would otherwise both read the same average, both compute a new one
   * from it, and the second would overwrite the first — losing a receipt's
   * worth of stock and leaving the valuation wrong in a way nothing would
   * flag. `SELECT ... FOR UPDATE` makes them queue.
   *
   * Always call inside a transaction; `manager` is required for that reason.
   */
  private async applyMovement(
    manager: EntityManager,
    params: {
      tenantId: string;
      materialId: string;
      locationId: string;
      type: StockMovementType;
      qtyDelta: number;
      unitCost: number;
      referenceType: StockReferenceType;
      referenceId?: string | null;
      actorId?: string | null;
      note?: string | null;
    },
  ): Promise<{ movement: StockMovement; valueDelta: number }> {
    const { tenantId, materialId, locationId } = params;

    // Take the row lock before reading the position. An upsert first so that
    // the very first movement for a material has something to lock.
    await manager.query(
      `INSERT INTO "stock_items" ("tenant_id", "material_id", "location_id")
       VALUES ($1, $2, $3)
       ON CONFLICT ("tenant_id", "material_id", "location_id") DO NOTHING`,
      [tenantId, materialId, locationId],
    );

    const locked = await manager
      .getRepository(StockItem)
      .createQueryBuilder('item')
      .setLock('pessimistic_write')
      .where('item.tenant_id = :tenantId', { tenantId })
      .andWhere('item.material_id = :materialId', { materialId })
      .andWhere('item.location_id = :locationId', { locationId })
      .getOne();

    if (!locked) {
      throw new NotFoundException(
        'Stock position could not be created or locked',
      );
    }

    const position = {
      qtyOnHand: locked.qtyOnHand,
      avgUnitCost: locked.avgUnitCost,
    };
    const result =
      params.qtyDelta > 0
        ? applyReceipt(position, params.qtyDelta, params.unitCost)
        : applyIssue(position, -params.qtyDelta);

    const wasLow = needsReorder(locked);
    locked.qtyOnHand = result.qtyOnHand;
    locked.avgUnitCost = result.avgUnitCost;
    await manager.getRepository(StockItem).save(locked);

    // Told once, when stock crosses the reorder point — not on every issue
    // while it stays below — and cleared when a delivery brings it back.
    const isLow = needsReorder(locked);
    if (isLow && !wasLow) {
      await this.notifications.notifyHolders(
        tenantId,
        PERMISSIONS.PURCHASE_ORDER_CREATE,
        {
          type: 'LOW_STOCK',
          title: `Stock is at or below its reorder point (${locked.qtyOnHand} on hand)`,
          body: 'Raise a purchase order from the reorder suggestions.',
          link: '/inventory',
          entityType: 'STOCK_ITEM',
          entityId: locked.id,
        },
        { manager },
      );
    } else if (wasLow && !isLow) {
      await this.notifications.resolve(tenantId, locked.id, manager);
    }

    const movement = await manager.getRepository(StockMovement).save(
      manager.getRepository(StockMovement).create({
        tenantId,
        materialId,
        locationId,
        type: params.type,
        qtyDelta: params.qtyDelta,
        unitCost: params.unitCost,
        avgUnitCostAfter: result.avgUnitCost,
        qtyOnHandAfter: result.qtyOnHand,
        referenceType: params.referenceType,
        referenceId: params.referenceId ?? null,
        actorId: params.actorId ?? null,
        note: params.note ?? null,
      }),
    );

    return { movement, valueDelta: result.valueDelta };
  }

  /* ------------------------------------------------------------------ *
   * Goods receipt
   * ------------------------------------------------------------------ */

  /**
   * Books a delivery in against a purchase order.
   *
   * Everything happens in one transaction: the stock ledger, the projection,
   * the order's received quantities, its status, and the journal entry. A
   * receipt that moved stock without posting the value — or the reverse —
   * would put the books and the shelf permanently out of step.
   */
  async receive(
    tenantId: string,
    purchaseOrderId: string,
    actorId: string,
    input: ReceiveInput,
  ): Promise<GoodsReceipt> {
    if (!input.lines?.length) {
      throw new BadRequestException('Nothing to receive');
    }

    return this.dataSource.transaction(async (manager) => {
      const order = await manager.getRepository(PurchaseOrder).findOne({
        where: { id: purchaseOrderId, tenantId, deletedAt: IsNull() },
      });
      if (!order) {
        throw new NotFoundException(
          `Purchase order ${purchaseOrderId} not found`,
        );
      }
      // Receiving against a draft would book in stock nobody authorised buying.
      if (!['SENT', 'APPROVED', 'PARTIALLY_RECEIVED'].includes(order.status)) {
        throw new BadRequestException(
          `${order.poNumber} is ${order.status.toLowerCase().replace(/_/g, ' ')} and cannot receive goods.`,
        );
      }

      const location = input.locationId
        ? await manager.getRepository(StockLocation).findOne({
            where: { id: input.locationId, tenantId, deletedAt: IsNull() },
          })
        : await this.ensureDefaultLocation(tenantId, manager);
      if (!location) throw new NotFoundException('Stock location not found');

      const policy = await manager
        .getRepository(PurchasePolicyEntity)
        .findOne({ where: { tenantId } });
      const tolerance = policy?.varianceTolerancePct ?? 0;

      const orderLines = await manager
        .getRepository(PurchaseOrderLine)
        .find({ where: { purchaseOrderId: order.id, tenantId } });
      const byId = new Map(orderLines.map((l) => [l.id, l]));

      const receiptLines: GoodsReceiptLine[] = [];
      /** In base currency: stock and the ledger are kept in it. */
      let totalValue = 0;
      // The rate the goods came in at. Stock is valued at it, GRNI is credited
      // at it, and the supplier's bill later clears GRNI at it, whatever the
      // rate has done by the time the bill arrives.
      const rate = await fxRateFor(manager, tenantId, order.currency, new Date());

      for (const input_line of input.lines) {
        const orderLine = byId.get(input_line.purchaseOrderLineId);
        if (!orderLine) {
          throw new BadRequestException(
            `Line ${input_line.purchaseOrderLineId} is not on ${order.poNumber}`,
          );
        }
        if (!(input_line.qtyReceived > 0)) {
          throw new BadRequestException(
            `Received quantity for "${orderLine.description}" must be above zero`,
          );
        }

        if (
          !isReceiptWithinTolerance(
            orderLine.qtyOrdered,
            orderLine.qtyReceived,
            input_line.qtyReceived,
            tolerance,
          )
        ) {
          const remaining = orderLine.qtyOrdered - orderLine.qtyReceived;
          throw new BadRequestException(
            `Receiving ${input_line.qtyReceived} of "${orderLine.description}" exceeds the ${remaining} still outstanding on ${order.poNumber}${
              tolerance > 0
                ? ` (tolerance ${(tolerance * 100).toFixed(1)}%)`
                : ''
            }.`,
          );
        }

        // Rejected goods are recorded but never enter stock: they are going
        // back, and the supplier's bill will still mention them.
        if (orderLine.materialId) {
          const { movement } = await this.applyMovement(manager, {
            tenantId,
            materialId: orderLine.materialId,
            locationId: location.id,
            type: 'RECEIPT',
            qtyDelta: input_line.qtyReceived,
            unitCost: roundCost(orderLine.unitCost * rate),
            referenceType: 'GOODS_RECEIPT',
            referenceId: order.id,
            actorId,
          });
          // What was received, at the price ordered, to the cent — exactly the
          // figure a supplier's bill will later clear from GRNI. Not the change
          // in stock value: that is qty × a moving average held at four
          // places, and the rounding in it would strand a few pence in GRNI
          // permanently, however correctly every bill matched.
          const lineBase = toBase(
            money(input_line.qtyReceived * orderLine.unitCost),
            rate,
          );
          totalValue = money(totalValue + lineBase);
          orderLine.receivedValueBase = roundCost(
            Number(orderLine.receivedValueBase) + lineBase,
          );

          receiptLines.push(
            manager.getRepository(GoodsReceiptLine).create({
              tenantId,
              purchaseOrderLineId: orderLine.id,
              materialId: orderLine.materialId,
              description: orderLine.description,
              qtyReceived: input_line.qtyReceived,
              qtyRejected: input_line.qtyRejected ?? 0,
              unitCost: orderLine.unitCost,
              stockMovementId: movement.id,
            }),
          );
        } else {
          // A free-text line (a delivery charge, a one-off part) has no stock
          // to move, but it is still received and still owed for.
          const lineBase = toBase(
            money(input_line.qtyReceived * orderLine.unitCost),
            rate,
          );
          totalValue = money(totalValue + lineBase);
          orderLine.receivedValueBase = roundCost(
            Number(orderLine.receivedValueBase) + lineBase,
          );
          receiptLines.push(
            manager.getRepository(GoodsReceiptLine).create({
              tenantId,
              purchaseOrderLineId: orderLine.id,
              materialId: null,
              description: orderLine.description,
              qtyReceived: input_line.qtyReceived,
              qtyRejected: input_line.qtyRejected ?? 0,
              unitCost: orderLine.unitCost,
              stockMovementId: null,
            }),
          );
        }

        orderLine.qtyReceived = Number(
          (orderLine.qtyReceived + input_line.qtyReceived).toFixed(4),
        );
        await manager.getRepository(PurchaseOrderLine).save(orderLine);
      }

      const sequenceValue = await allocateNextSequenceValue(
        manager,
        tenantId,
        'goods_receipt_number',
      );

      const receipt = await manager.getRepository(GoodsReceipt).save(
        manager.getRepository(GoodsReceipt).create({
          tenantId,
          receiptNumber: formatSequenceNumber('GRN', sequenceValue),
          purchaseOrderId: order.id,
          locationId: location.id,
          receivedById: actorId,
          receivedAt: new Date(),
          supplierReference: input.supplierReference ?? null,
          notes: input.notes ?? null,
          totalValue,
          fxRate: rate,
          lines: receiptLines,
        }),
      );

      // Dr Inventory / Cr GRNI. The credit sits in goods-received-not-invoiced
      // until the supplier's bill arrives and clears it.
      if (totalValue !== 0) {
        const lines = await this.ledger.resolveLines(
          tenantId,
          [
            {
              role: LEDGER_ROLES.INVENTORY,
              accountName: 'Inventory',
              debit: totalValue,
              credit: 0,
              description: `Goods received ${receipt.receiptNumber} against ${order.poNumber}`,
            },
            {
              role: LEDGER_ROLES.GRNI,
              accountName: 'Goods received not invoiced',
              debit: 0,
              credit: totalValue,
              description: `Awaiting bill from ${order.supplierName}`,
            },
          ],
          manager,
        );

        const entry = await manager.getRepository(JournalEntry).save(
          manager.getRepository(JournalEntry).create({
            tenantId,
            entryNumber: `JE-GRN-${receipt.receiptNumber}`,
            referenceType: 'STOCK',
            referenceId: receipt.id,
            entryDate: new Date(),
            totalAmount: totalValue,
            // Lines are already base amounts, summed per line so GRNI clears
            // to the cent; the rate is recorded for the audit trail.
            currency: order.currency,
            fxRate: rate,
            lines,
          }),
        );
        receipt.journalEntryId = entry.id;
        await manager.getRepository(GoodsReceipt).save(receipt);
      }

      // Whatever arrived is no longer on order.
      await this.adjustOnOrder(
        tenantId,
        input.lines.map((l) => {
          const orderLine = byId.get(l.purchaseOrderLineId);
          return {
            materialId: orderLine?.materialId ?? null,
            qty: -l.qtyReceived,
          };
        }),
        manager,
      );

      // Status follows the lines, not the other way round.
      const refreshed = await manager
        .getRepository(PurchaseOrderLine)
        .find({ where: { purchaseOrderId: order.id, tenantId } });
      const fullyReceived = refreshed.every(
        (l) => l.qtyReceived >= l.qtyOrdered,
      );
      order.status = fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      await manager.getRepository(PurchaseOrder).save(order);

      return receipt;
    });
  }

  async listReceipts(
    tenantId: string,
    purchaseOrderId?: string,
  ): Promise<GoodsReceipt[]> {
    return this.receipts.find({
      where: purchaseOrderId
        ? { tenantId, purchaseOrderId, deletedAt: IsNull() }
        : { tenantId, deletedAt: IsNull() },
      order: { receivedAt: 'DESC' },
    });
  }

  /* ------------------------------------------------------------------ *
   * Work orders
   * ------------------------------------------------------------------ */

  /**
   * Moves material between the shelf and a job, inside the caller's transaction.
   *
   * A positive `qty` issues to the job at the moving average; a negative one
   * returns unused material at `returnUnitCost` — the average the job was
   * charged, so a return takes back exactly what it cost rather than today's
   * average, and the job's WIP can come back to zero.
   *
   * Issuing more than is on hand is refused here even though a manual
   * adjustment may go negative. A job charged from a negative balance is
   * charged at whatever stale average is left, and the actual cost the
   * work order exists to measure would be wrong without anything saying so.
   *
   * Posting the value is the caller's job: this knows about stock, not WIP.
   */
  async moveForWorkOrder(
    manager: EntityManager,
    params: {
      tenantId: string;
      materialId: string;
      locationId?: string;
      qty: number;
      workOrderId: string;
      workOrderNumber: string;
      actorId: string | null;
      returnUnitCost?: number;
    },
  ): Promise<{ movement: StockMovement; value: number }> {
    return this.moveForReference(manager, {
      ...params,
      referenceType: 'WORK_ORDER',
      referenceId: params.workOrderId,
      referenceNumber: params.workOrderNumber,
    });
  }

  /** Goods leaving on a delivery. Same rules as an issue to a job. */
  async issueForDelivery(
    manager: EntityManager,
    params: {
      tenantId: string;
      materialId: string;
      qty: number;
      deliveryNoteId: string;
      deliveryNoteNumber: string;
      actorId: string | null;
    },
  ): Promise<{ movement: StockMovement; value: number }> {
    return this.moveForReference(manager, {
      ...params,
      referenceType: 'DELIVERY_NOTE',
      referenceId: params.deliveryNoteId,
      referenceNumber: params.deliveryNoteNumber,
    });
  }

  private async moveForReference(
    manager: EntityManager,
    params: {
      tenantId: string;
      materialId: string;
      locationId?: string;
      qty: number;
      referenceType: 'WORK_ORDER' | 'DELIVERY_NOTE';
      referenceId: string;
      referenceNumber: string;
      actorId: string | null;
      returnUnitCost?: number;
    },
  ): Promise<{ movement: StockMovement; value: number }> {
    if (!params.qty) {
      throw new BadRequestException('Enter a quantity');
    }
    const location = params.locationId
      ? await manager.getRepository(StockLocation).findOne({
          where: {
            id: params.locationId,
            tenantId: params.tenantId,
            deletedAt: IsNull(),
          },
        })
      : await this.ensureDefaultLocation(params.tenantId, manager);
    if (!location) throw new NotFoundException('Stock location not found');

    if (params.qty > 0) {
      const onHand = await manager.getRepository(StockItem).findOne({
        where: {
          tenantId: params.tenantId,
          materialId: params.materialId,
          locationId: location.id,
        },
      });
      const available = onHand?.qtyOnHand ?? 0;
      if (available < params.qty) {
        throw new BadRequestException(
          `Only ${available} on hand at ${location.name}. Book in the delivery or correct the count before issuing ${params.qty}.`,
        );
      }
    }

    const { movement, valueDelta } = await this.applyMovement(manager, {
      tenantId: params.tenantId,
      materialId: params.materialId,
      locationId: location.id,
      type: params.qty > 0 ? 'ISSUE' : 'RETURN',
      // The ledger's sign is the shelf's: issuing to a job takes stock out.
      // `params.qty` is signed from the job's side, so it flips here.
      qtyDelta: -params.qty,
      unitCost: params.qty > 0 ? 0 : roundCost(params.returnUnitCost ?? 0),
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      actorId: params.actorId,
      note: `${params.qty > 0 ? (params.referenceType === 'DELIVERY_NOTE' ? 'Dispatched on' : 'Issued to') : 'Returned from'} ${params.referenceNumber}`,
    });

    // An issue is valued at the average it left at; a return at the price the
    // job was charged, which is what `applyReceipt` folds back in.
    const value =
      params.qty > 0
        ? money(Math.abs(valueDelta))
        : money(Math.abs(params.qty) * roundCost(params.returnUnitCost ?? 0));
    return { movement, value };
  }

  /* ------------------------------------------------------------------ *
   * Manual adjustment
   * ------------------------------------------------------------------ */

  /**
   * Corrects a quantity after a count or a write-off.
   *
   * A correction is another movement, never an edit to history, and it always
   * carries a note: an adjustment nobody can explain is the thing that erodes
   * trust in the whole figure.
   */
  async adjust(
    tenantId: string,
    actorId: string,
    input: {
      materialId: string;
      locationId?: string;
      qtyDelta: number;
      note: string;
    },
  ): Promise<StockMovement> {
    if (!input.qtyDelta) {
      throw new BadRequestException('An adjustment of zero changes nothing');
    }
    if (!input.note?.trim()) {
      throw new BadRequestException('Adjustments need a reason');
    }

    return this.dataSource.transaction(async (manager) => {
      const location = input.locationId
        ? await manager.getRepository(StockLocation).findOne({
            where: { id: input.locationId, tenantId, deletedAt: IsNull() },
          })
        : await this.ensureDefaultLocation(tenantId, manager);
      if (!location) throw new NotFoundException('Stock location not found');

      const { movement, valueDelta } = await this.applyMovement(manager, {
        tenantId,
        materialId: input.materialId,
        locationId: location.id,
        type: 'ADJUSTMENT',
        qtyDelta: input.qtyDelta,
        // An adjustment up is valued at the standing average, not a new price;
        // it is a correction to a count, not a purchase.
        unitCost: 0,
        referenceType: 'MANUAL',
        actorId,
        note: input.note.trim(),
      });

      // Writing stock off is a real cost and has to land somewhere.
      if (valueDelta !== 0) {
        const lines = await this.ledger.resolveLines(
          tenantId,
          valueDelta < 0
            ? [
                {
                  role: LEDGER_ROLES.COGS,
                  accountName: 'Stock adjustment',
                  debit: Math.abs(valueDelta),
                  credit: 0,
                  description: input.note.trim(),
                },
                {
                  role: LEDGER_ROLES.INVENTORY,
                  accountName: 'Inventory',
                  debit: 0,
                  credit: Math.abs(valueDelta),
                  description: input.note.trim(),
                },
              ]
            : [
                {
                  role: LEDGER_ROLES.INVENTORY,
                  accountName: 'Inventory',
                  debit: valueDelta,
                  credit: 0,
                  description: input.note.trim(),
                },
                {
                  role: LEDGER_ROLES.COGS,
                  accountName: 'Stock adjustment',
                  debit: 0,
                  credit: valueDelta,
                  description: input.note.trim(),
                },
              ],
          manager,
        );

        await manager.getRepository(JournalEntry).save(
          manager.getRepository(JournalEntry).create({
            tenantId,
            entryNumber: `JE-ADJ-${movement.id.slice(0, 8)}`,
            referenceType: 'STOCK',
            referenceId: movement.id,
            entryDate: new Date(),
            totalAmount: Math.abs(valueDelta),
            lines,
          }),
        );
      }

      return movement;
    });
  }
}
