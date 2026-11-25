import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import {
  reviewMaterialCosts,
  type MaterialCostBasis,
  type MaterialCostReview,
} from '@saas/shared';
import { GoodsReceiptLine } from '../inventory/entities/goods-receipt.entity';
import { StockItem } from '../inventory/entities/stock-item.entity';
import { PurchaseOrderLine } from '../purchasing/entities/purchase-order-line.entity';
import { PurchaseOrder } from '../purchasing/entities/purchase-order.entity';
import { SupplierMaterial } from '../purchasing/entities/supplier-material.entity';
import { Supplier } from '../purchasing/entities/supplier.entity';
import { fxRateFor } from '../finance/fx';
import { CatalogService } from './catalog.service';
import { CatalogItem } from './entities/catalog-item.entity';
import { Material } from './entities/material.entity';

/** How far back receipts are read for "last price paid". */
const RECEIPT_WINDOW_DAYS = 730;
const RECEIPT_ROW_LIMIT = 5000;

interface ReceiptRow {
  materialId: string;
  unitCost: string;
  fxRate: string;
  receivedAt: Date | string;
  receiptNumber: string;
  supplierName: string | null;
  lineUom: string;
  materialUom: string;
}

/**
 * The catalog's material costs against what the shop pays: the last goods
 * receipt, the moving average in stock and the supplier's listed price.
 * Reads only, apart from `apply`, which is the ordinary catalog update with a
 * figure this service worked out, never one sent by the browser.
 */
@Injectable()
export class MaterialCostsService {
  constructor(
    @InjectRepository(Material)
    private readonly materials: Repository<Material>,
    @InjectRepository(CatalogItem)
    private readonly items: Repository<CatalogItem>,
    @InjectRepository(GoodsReceiptLine)
    private readonly receiptLines: Repository<GoodsReceiptLine>,
    @InjectRepository(StockItem)
    private readonly stock: Repository<StockItem>,
    @InjectRepository(SupplierMaterial)
    private readonly supplierMaterials: Repository<SupplierMaterial>,
    @InjectRepository(Supplier)
    private readonly suppliers: Repository<Supplier>,
    private readonly catalog: CatalogService,
  ) {}

  async review(tenantId: string): Promise<MaterialCostReview> {
    const [materials, stockItems] = await Promise.all([
      this.materials.find({ where: { tenantId, deletedAt: IsNull() } }),
      this.items.find({
        where: {
          tenantId,
          deletedAt: IsNull(),
          stockMaterialId: Not(IsNull()),
        },
      }),
    ]);
    if (!materials.length) return { checked: 0, rows: [], notes: [] };
    const ids = materials.map((m) => m.id);

    const [receipts, positions, supplierPrices] = await Promise.all([
      this.lastReceipts(tenantId),
      this.stock.find({ where: { tenantId, materialId: In(ids) } }),
      this.supplierPrices(tenantId, ids),
    ]);

    return reviewMaterialCosts({
      materials: materials.map((m) => ({
        id: m.id,
        name: m.name,
        uom: m.uom,
        costPerUom: Number(m.costPerUom),
      })),
      stockItems: stockItems
        .filter((i) => i.stockMaterialId)
        .map((i) => ({
          id: i.id,
          name: i.name,
          standardCost: Number(i.standardCost),
          stockMaterialId: i.stockMaterialId!,
        })),
      lastReceipts: receipts.last,
      otherUnitReceipts: receipts.otherUnit,
      positions: positions.map((p) => ({
        materialId: p.materialId,
        qtyOnHand: Number(p.qtyOnHand),
        avgUnitCost: Number(p.avgUnitCost),
      })),
      supplierPrices,
    });
  }

  /**
   * Sets a catalog cost to one of the figures the review shows. The figure is
   * computed again here; the request only says which one.
   */
  async apply(
    tenantId: string,
    target: { type: 'MATERIAL' | 'CATALOG_ITEM'; id: string },
    basis: MaterialCostBasis,
  ): Promise<Material | CatalogItem> {
    const review = await this.review(tenantId);
    const row = review.rows.find(
      (r) => r.target.type === target.type && r.target.id === target.id,
    );
    const figure = row?.figures.find((f) => f.basis === basis);
    if (!row || !figure) {
      throw new BadRequestException(
        'That cost is already in line with what you pay, or there is no such figure for it any more. Reload the list.',
      );
    }
    return target.type === 'MATERIAL'
      ? this.catalog.updateMaterial(tenantId, target.id, {
          costPerUom: figure.unitCost,
        })
      : this.catalog.updateItem(tenantId, target.id, {
          standardCost: figure.unitCost,
        });
  }

  /**
   * The newest receipt line per material, converted to base currency at the
   * rate the goods came in at. A line ordered in a different unit from the
   * material's is left out and counted: there is no safe conversion between,
   * say, a roll and a metre without knowing the roll.
   */
  private async lastReceipts(tenantId: string): Promise<{
    last: MaterialCostReviewLast[];
    otherUnit: { materialId: string; count: number }[];
  }> {
    const from = new Date(Date.now() - RECEIPT_WINDOW_DAYS * 86_400_000);
    const rows = await this.receiptLines
      .createQueryBuilder('l')
      .innerJoin('l.goodsReceipt', 'g')
      .innerJoin(PurchaseOrderLine, 'pol', 'pol.id = l.purchaseOrderLineId')
      .innerJoin(Material, 'm', 'm.id = l.materialId')
      .leftJoin(PurchaseOrder, 'po', 'po.id = g.purchaseOrderId')
      .leftJoin(Supplier, 's', 's.id = po.supplierId')
      .select('l.materialId', 'materialId')
      .addSelect('l.unitCost', 'unitCost')
      .addSelect('g.fxRate', 'fxRate')
      .addSelect('g.receivedAt', 'receivedAt')
      .addSelect('g.receiptNumber', 'receiptNumber')
      .addSelect('s.companyName', 'supplierName')
      .addSelect('pol.uom', 'lineUom')
      .addSelect('m.uom', 'materialUom')
      .where('l.tenantId = :tenantId', { tenantId })
      .andWhere('l.materialId IS NOT NULL')
      .andWhere('l.qtyReceived > 0')
      .andWhere('g.receivedAt >= :from', { from })
      .orderBy('g.receivedAt', 'DESC')
      .addOrderBy('g.receiptNumber', 'DESC')
      .limit(RECEIPT_ROW_LIMIT)
      .getRawMany<ReceiptRow>();

    const last = new Map<string, MaterialCostReviewLast>();
    const otherUnit = new Map<string, number>();
    for (const r of rows) {
      if (r.lineUom !== r.materialUom) {
        otherUnit.set(r.materialId, (otherUnit.get(r.materialId) ?? 0) + 1);
        continue;
      }
      if (last.has(r.materialId)) continue;
      last.set(r.materialId, {
        materialId: r.materialId,
        unitCost:
          Math.round(Number(r.unitCost) * Number(r.fxRate || 1) * 10_000) /
          10_000,
        receivedAt: new Date(r.receivedAt).toISOString(),
        receiptNumber: r.receiptNumber,
        supplierName: r.supplierName,
      });
    }
    return {
      last: [...last.values()],
      otherUnit: [...otherUnit].map(([materialId, count]) => ({
        materialId,
        count,
      })),
    };
  }

  /** One price per material: the preferred supplier's, else the cheapest. */
  private async supplierPrices(tenantId: string, materialIds: string[]) {
    const rows = await this.supplierMaterials.find({
      where: { tenantId, materialId: In(materialIds) },
    });
    if (!rows.length) return [];
    const suppliers = await this.suppliers.find({
      where: { tenantId, id: In([...new Set(rows.map((r) => r.supplierId))]) },
    });
    const byId = new Map(suppliers.map((s) => [s.id, s]));
    const manager = this.materials.manager;
    const rates = new Map<string, number | null>();
    const rateOf = async (currency: string | null) => {
      const code = (currency ?? '').trim().toUpperCase();
      if (!rates.has(code)) {
        try {
          rates.set(code, await fxRateFor(manager, tenantId, code));
        } catch {
          rates.set(code, null);
        }
      }
      return rates.get(code)!;
    };

    rows.sort(
      (a, b) =>
        Number(b.isPreferred) - Number(a.isPreferred) ||
        Number(a.unitCost) - Number(b.unitCost),
    );
    const out: {
      materialId: string;
      supplierName: string;
      unitCost: number | null;
      currency: string;
    }[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.materialId)) continue;
      seen.add(r.materialId);
      const supplier = byId.get(r.supplierId);
      if (!supplier || supplier.deletedAt) continue;
      const rate = await rateOf(supplier.currency);
      out.push({
        materialId: r.materialId,
        supplierName: supplier.companyName,
        unitCost:
          rate == null
            ? null
            : Math.round(Number(r.unitCost) * rate * 10_000) / 10_000,
        currency: supplier.currency ?? '',
      });
    }
    return out;
  }
}

interface MaterialCostReviewLast {
  materialId: string;
  unitCost: number;
  receivedAt: string;
  receiptNumber: string;
  supplierName: string | null;
}
