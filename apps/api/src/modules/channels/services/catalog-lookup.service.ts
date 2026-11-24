import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository, type SelectQueryBuilder } from 'typeorm';
import { CatalogItem } from '@/modules/catalog/entities/catalog-item.entity';
import { Material } from '@/modules/catalog/entities/material.entity';
import { StockItem } from '@/modules/inventory/entities/stock-item.entity';
import { Organization } from '@/modules/organizations/entities/organization.entity';

const MAX_MATCHES = 5;

/** What a customer may be told about an item's price: the list price, nothing else. */
export interface CustomerPriceView {
  name: string;
  sku: string;
  unit: string;
  listPrice: number;
  currency: string;
  vatPercent: number;
  leadTimeDays: number;
}

export type StockLevel = 'IN_STOCK' | 'LOW' | 'OUT_OF_STOCK' | 'NOT_TRACKED';

export interface CustomerStockView {
  name: string;
  unit: string;
  level: StockLevel;
  /** Only when the agent is allowed to give the number. */
  available?: number;
}

export interface CatalogLookupResult<T> {
  askedFor: string;
  found: boolean;
  records: T[];
}

/**
 * The catalogue as a customer agent may read it, for anyone who writes.
 *
 * Only the business's public facts: list prices of items the owner marked
 * for customers, and whether something is in stock. It never reads quotes,
 * orders or a customer's own prices, so nothing one customer was quoted can
 * reach another, and it never returns a cost, a margin or a supplier.
 */
@Injectable()
export class CatalogLookupService {
  constructor(
    @InjectRepository(CatalogItem)
    private readonly items: Repository<CatalogItem>,
    @InjectRepository(Material)
    private readonly materials: Repository<Material>,
    @InjectRepository(StockItem)
    private readonly stock: Repository<StockItem>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
  ) {}

  async prices(
    organizationId: string,
    query: string,
  ): Promise<CatalogLookupResult<CustomerPriceView>> {
    const askedFor = query.trim();
    if (!askedFor) return { askedFor, found: false, records: [] };
    const rows = await matching(
      this.items
        .createQueryBuilder('item')
        .where('item.tenantId = :organizationId', { organizationId })
        .andWhere('item.isActive = true')
        .andWhere('item.showPriceToCustomers = true'),
      'item',
      askedFor,
    ).getMany();
    if (!rows.length) return { askedFor, found: false, records: [] };
    const org = await this.organizations.findOne({
      where: { id: organizationId },
    });
    const currency = org?.baseCurrency ?? 'AED';
    return {
      askedFor,
      found: true,
      records: rows.map((item) => ({
        name: item.name,
        sku: item.sku,
        unit: item.uom,
        listPrice: Number(item.listPrice),
        currency,
        vatPercent: Number(item.taxRate),
        leadTimeDays: item.leadTimeDays,
      })),
    };
  }

  async stockLevels(
    organizationId: string,
    query: string,
    withQuantity: boolean,
  ): Promise<CatalogLookupResult<CustomerStockView>> {
    const askedFor = query.trim();
    if (!askedFor) return { askedFor, found: false, records: [] };

    // A sold item answers with the stock of the material it is taken from.
    const [items, materials] = await Promise.all([
      matching(
        this.items
          .createQueryBuilder('item')
          .where('item.tenantId = :organizationId', { organizationId })
          .andWhere('item.isActive = true')
          .andWhere('item.stockMaterialId IS NOT NULL'),
        'item',
        askedFor,
      ).getMany(),
      matching(
        this.materials
          .createQueryBuilder('material')
          .where('material.tenantId = :organizationId', { organizationId })
          .andWhere('material.isActive = true'),
        'material',
        askedFor,
      ).getMany(),
    ]);
    const wanted: { name: string; unit: string; materialId: string }[] = [
      ...items.map((item) => ({
        name: item.name,
        unit: item.uom,
        materialId: item.stockMaterialId!,
      })),
      ...materials.map((material) => ({
        name: material.name,
        unit: material.uom,
        materialId: material.id,
      })),
    ].slice(0, MAX_MATCHES);
    if (!wanted.length) return { askedFor, found: false, records: [] };

    const rows = await this.stock.find({
      where: {
        tenantId: organizationId,
        materialId: In([...new Set(wanted.map((w) => w.materialId))]),
      },
    });
    return {
      askedFor,
      found: true,
      records: wanted.map((w) => {
        const shelves = rows.filter((row) => row.materialId === w.materialId);
        const level = stockLevel(shelves);
        return {
          name: w.name,
          unit: w.unit,
          level,
          ...(withQuantity && level !== 'NOT_TRACKED'
            ? { available: Math.max(0, available(shelves)) }
            : {}),
        };
      }),
    };
  }
}

function matching<T extends CatalogItem | Material>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  query: string,
): SelectQueryBuilder<T> {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[%_\\]/g, ''))
    .filter((word) => word.length >= 2)
    .slice(0, 6);
  if (!words.length) return qb.andWhere('1 = 0');
  words.forEach((word, i) => {
    qb.andWhere(
      new Brackets((w) =>
        w
          .where(`LOWER(${alias}.name) LIKE :w${i}`, { [`w${i}`]: `%${word}%` })
          .orWhere(`LOWER(${alias}.sku) LIKE :w${i}`),
      ),
    );
  });
  return qb.orderBy(`${alias}.name`, 'ASC').take(MAX_MATCHES);
}

function available(shelves: StockItem[]): number {
  return shelves.reduce(
    (sum, row) => sum + Number(row.qtyOnHand) - Number(row.qtyReserved),
    0,
  );
}

/** In stock, low (at or under the reorder point) or out; not tracked when nothing is on record. */
export function stockLevel(shelves: StockItem[]): StockLevel {
  if (!shelves.length) return 'NOT_TRACKED';
  const free = available(shelves);
  if (free <= 0) return 'OUT_OF_STOCK';
  const reorderAt = shelves.reduce(
    (sum, row) => sum + Number(row.reorderPoint ?? 0),
    0,
  );
  return reorderAt > 0 && free <= reorderAt ? 'LOW' : 'IN_STOCK';
}
