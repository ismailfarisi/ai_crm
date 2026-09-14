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
  replayMovements,
  roundCost,
  type StockMovementType,
  type StockReferenceType,
} from '@saas/shared';
import {
  allocateNextSequenceValue,
  formatSequenceNumber,
} from '@/database/tenant-sequence.util';
import { LedgerService } from '../finance/ledger.service';
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
    const rows: Array<Record<string, string | number | null>> = await this.stockItems
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
  ): Promise<{ item: StockItemView; shortfall: number; suggestedQty: number }[]> {
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

    locked.qtyOnHand = result.qtyOnHand;
    locked.avgUnitCost = result.avgUnitCost;
    await manager.getRepository(StockItem).save(locked);

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
      let totalValue = 0;

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
          const { movement, valueDelta } = await this.applyMovement(manager, {
            tenantId,
            materialId: orderLine.materialId,
            locationId: location.id,
            type: 'RECEIPT',
            qtyDelta: input_line.qtyReceived,
            unitCost: orderLine.unitCost,
            referenceType: 'GOODS_RECEIPT',
            referenceId: order.id,
            actorId,
          });
          totalValue = roundCost(totalValue + valueDelta);

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
          totalValue = roundCost(
            totalValue + input_line.qtyReceived * orderLine.unitCost,
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
            lines,
          }),
        );
        receipt.journalEntryId = entry.id;
        await manager.getRepository(GoodsReceipt).save(receipt);
      }

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
