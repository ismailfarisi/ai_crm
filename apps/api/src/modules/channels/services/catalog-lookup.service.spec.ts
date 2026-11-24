import { CatalogLookupService, stockLevel } from './catalog-lookup.service';

/** A query builder that records its clauses and returns `rows`. */
function qb(rows: unknown[]) {
  const clauses: string[] = [];
  const builder: Record<string, jest.Mock> = {};
  for (const name of ['where', 'andWhere', 'orderBy', 'take']) {
    builder[name] = jest.fn((clause: unknown) => {
      if (typeof clause === 'string') clauses.push(clause);
      return builder;
    });
  }
  builder.getMany = jest.fn().mockResolvedValue(rows);
  return { builder, clauses };
}

const FLYERS = {
  id: 'item-1',
  name: 'A5 flyers',
  sku: 'FLY-A5',
  uom: 'Pack',
  listPrice: 120,
  standardCost: 41.5,
  taxRate: 5,
  leadTimeDays: 3,
  stockMaterialId: 'mat-1',
};

function setup(opts: { items?: unknown[]; materials?: unknown[]; stock?: unknown[] } = {}) {
  const items = qb(opts.items ?? [FLYERS]);
  const materials = qb(opts.materials ?? []);
  const stock = { find: jest.fn().mockResolvedValue(opts.stock ?? []) };
  const service = new CatalogLookupService(
    { createQueryBuilder: jest.fn(() => items.builder) } as never,
    { createQueryBuilder: jest.fn(() => materials.builder) } as never,
    stock as never,
    { findOne: jest.fn().mockResolvedValue({ baseCurrency: 'AED' }) } as never,
  );
  return { service, items, materials, stock };
}

describe('CatalogLookupService', () => {
  it('returns list prices only for active items the owner marked, never the cost', async () => {
    const { service, items } = setup();
    const result = await service.prices('org', 'flyers');

    expect(items.clauses).toEqual(
      expect.arrayContaining([
        'item.tenantId = :organizationId',
        'item.isActive = true',
        'item.showPriceToCustomers = true',
      ]),
    );
    expect(result.records).toEqual([
      {
        name: 'A5 flyers',
        sku: 'FLY-A5',
        unit: 'Pack',
        listPrice: 120,
        currency: 'AED',
        vatPercent: 5,
        leadTimeDays: 3,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/41\.5|cost|margin/i);
  });

  it('finds nothing for an empty question', async () => {
    const { service, items } = setup();
    expect(await service.prices('org', '  ')).toEqual({
      askedFor: '',
      found: false,
      records: [],
    });
    expect(items.builder.getMany).not.toHaveBeenCalled();
  });

  it('gives stock as a level, and the number only when allowed', async () => {
    const shelf = {
      materialId: 'mat-1',
      qtyOnHand: 12,
      qtyReserved: 4,
      reorderPoint: 10,
      avgUnitCost: 9.99,
    };
    const { service, stock } = setup({ stock: [shelf] });
    const hidden = await service.stockLevels('org', 'flyers', false);
    expect(stock.find.mock.calls[0][0].where.tenantId).toBe('org');
    expect(hidden.records).toEqual([{ name: 'A5 flyers', unit: 'Pack', level: 'LOW' }]);
    expect(JSON.stringify(hidden)).not.toMatch(/9\.99/);

    const shown = await service.stockLevels('org', 'flyers', true);
    expect(shown.records[0]).toEqual({
      name: 'A5 flyers',
      unit: 'Pack',
      level: 'LOW',
      available: 8,
    });
  });

  it('reads levels as in stock, low, out, or not tracked', () => {
    const row = (onHand: number, reserved = 0, reorderPoint: number | null = 5) =>
      ({ qtyOnHand: onHand, qtyReserved: reserved, reorderPoint }) as never;
    expect(stockLevel([])).toBe('NOT_TRACKED');
    expect(stockLevel([row(0)])).toBe('OUT_OF_STOCK');
    expect(stockLevel([row(6, 6)])).toBe('OUT_OF_STOCK');
    expect(stockLevel([row(5)])).toBe('LOW');
    expect(stockLevel([row(50)])).toBe('IN_STOCK');
    expect(stockLevel([row(3, 0, null)])).toBe('IN_STOCK');
    // Two locations add up.
    expect(stockLevel([row(3), row(4)])).toBe('LOW');
    expect(stockLevel([row(30), row(4)])).toBe('IN_STOCK');
  });
});
