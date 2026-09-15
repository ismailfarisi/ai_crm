import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InventoryService } from './inventory.service';

const tenantId = '11111111-1111-1111-1111-111111111111';
const actorId = 'user-1';
const locationId = 'loc-1';

interface Seed {
  orderStatus?: string;
  orderLines?: any[];
  stock?: any[];
  tolerance?: number;
}

function makeService(seed: Seed = {}) {
  const order: any = {
    id: 'po-1',
    tenantId,
    poNumber: 'PO-2026-0001',
    supplierName: 'Papertree Ltd',
    status: seed.orderStatus ?? 'SENT',
    deletedAt: null,
  };

  const orderLines: any[] = seed.orderLines ?? [
    {
      id: 'pol-1',
      tenantId,
      purchaseOrderId: 'po-1',
      materialId: 'mat-1',
      description: '350gsm board SRA2',
      qtyOrdered: 500,
      qtyReceived: 0,
      uom: 'SHEET',
      unitCost: 0.42,
    },
  ];

  const stock: any[] = seed.stock ?? [];
  const movements: any[] = [];
  let sequenceValue = 0;
  const journals: any[] = [];
  const receipts: any[] = [];
  const locations: any[] = [
    {
      id: locationId,
      tenantId,
      name: 'Main store',
      isDefault: true,
      deletedAt: null,
    },
  ];

  const repoFor = (entity: any) => {
    const name = entity?.name ?? entity;
    const store =
      {
        PurchaseOrder: [order],
        PurchaseOrderLine: orderLines,
        StockItem: stock,
        StockMovement: movements,
        StockLocation: locations,
        GoodsReceipt: receipts,
        GoodsReceiptLine: [],
        JournalEntry: journals,
        PurchasePolicyEntity:
          seed.tolerance == null
            ? []
            : [{ tenantId, varianceTolerancePct: seed.tolerance }],
      }[name as string] ?? [];

    return {
      findOne: jest.fn(
        async ({ where }: any) =>
          store.find((row) =>
            Object.entries(where).every(([k, v]) =>
              v && typeof v === 'object' ? row[k] == null : row[k] === v,
            ),
          ) ?? null,
      ),
      find: jest.fn(async ({ where }: any = {}) =>
        where
          ? store.filter((row) =>
              Object.entries(where).every(([k, v]) =>
                v && typeof v === 'object' ? row[k] == null : row[k] === v,
              ),
            )
          : store,
      ),
      create: jest.fn((dto: any) => ({
        id: `${String(name).toLowerCase()}-${store.length + 1}`,
        ...dto,
      })),
      save: jest.fn(async (row: any) => {
        const arr = store;
        const idx = arr.findIndex((x) => x.id === row.id);
        if (idx >= 0) arr[idx] = { ...arr[idx], ...row };
        else arr.push(row);
        return row;
      }),
      createQueryBuilder: jest.fn(() => {
        const b: any = {
          setLock: () => b,
          where: () => b,
          andWhere: () => b,
          getOne: async () => store[0] ?? null,
        };
        return b;
      }),
    };
  };

  const manager: any = {
    getRepository: jest.fn(repoFor),
    query: jest.fn(async (sql: string, params: any[]) => {
      // Emulate the upsert that guarantees a row exists to lock.
      if (sql.includes('INSERT INTO "stock_items"')) {
        const [t, materialId, locId] = params;
        if (
          !stock.some(
            (s) => s.materialId === materialId && s.locationId === locId,
          )
        ) {
          stock.push({
            id: `stock-${stock.length + 1}`,
            tenantId: t,
            materialId,
            locationId: locId,
            qtyOnHand: 0,
            qtyReserved: 0,
            qtyOnOrder: 0,
            avgUnitCost: 0,
            reorderPoint: null,
            reorderQty: null,
          });
        }
      }
      // `allocateNextSequenceValue` expects a row back from its upsert.
      if (sql.includes('tenant_sequences')) {
        sequenceValue += 1;
        return [{ current_value: sequenceValue }];
      }
      return [];
    }),
  };

  const dataSource: any = {
    manager,
    transaction: jest.fn(async (cb: any) => cb(manager)),
  };

  const ledger = {
    resolveLines: jest.fn(async (_t: string, lines: any[]) =>
      lines.map((l) => ({
        ledgerAccountId: `ledger-${l.role}`,
        ledgerAccountCode:
          { INVENTORY: '1200', GRNI: '1250', COGS: '5000' }[l.role as string] ??
          '6000',
        financeAccountId: null,
        ...l,
      })),
    ),
  };

  const service = new InventoryService(
    repoFor('StockItem') as any,
    repoFor('StockMovement') as any,
    repoFor('StockLocation') as any,
    repoFor('GoodsReceipt') as any,
    repoFor('PurchaseOrder') as any,
    repoFor('PurchasePolicyEntity') as any,
    ledger as any,
    dataSource,
  );

  return { service, order, orderLines, stock, movements, journals, ledger };
}

describe('InventoryService.receive', () => {
  it('moves stock, values it, and posts Dr Inventory / Cr GRNI', async () => {
    const { service, stock, movements, journals } = makeService();

    const receipt = await service.receive(tenantId, 'po-1', actorId, {
      lines: [{ purchaseOrderLineId: 'pol-1', qtyReceived: 500 }],
    });

    expect(receipt.receiptNumber).toMatch(/^GRN-\d{4}-\d+$/);
    expect(stock[0].qtyOnHand).toBe(500);
    expect(stock[0].avgUnitCost).toBe(0.42);
    expect(movements[0].type).toBe('RECEIPT');
    expect(movements[0].qtyDelta).toBe(500);

    const entry = journals[0];
    expect(entry.referenceType).toBe('STOCK');
    expect(entry.totalAmount).toBe(210);
    expect(entry.lines.map((l: any) => l.ledgerAccountCode)).toEqual([
      '1200',
      '1250',
    ]);
    expect(entry.lines[0].debit).toBe(210);
    expect(entry.lines[1].credit).toBe(210);
  });

  it('blends the average across two receipts at different prices', async () => {
    const { service, stock } = makeService({
      orderLines: [
        {
          id: 'pol-1',
          tenantId,
          purchaseOrderId: 'po-1',
          materialId: 'mat-1',
          description: 'Board',
          qtyOrdered: 400,
          qtyReceived: 0,
          uom: 'SHEET',
          unitCost: 1,
        },
      ],
    });

    await service.receive(tenantId, 'po-1', actorId, {
      lines: [{ purchaseOrderLineId: 'pol-1', qtyReceived: 100 }],
    });
    expect(stock[0].avgUnitCost).toBe(1);

    // Second delivery at a different price on the same line.
    const { service: s2, stock: stock2 } = makeService({
      stock: [
        {
          id: 'stock-1',
          tenantId,
          materialId: 'mat-1',
          locationId,
          qtyOnHand: 100,
          qtyReserved: 0,
          qtyOnOrder: 0,
          avgUnitCost: 1,
          reorderPoint: null,
          reorderQty: null,
        },
      ],
      orderLines: [
        {
          id: 'pol-1',
          tenantId,
          purchaseOrderId: 'po-1',
          materialId: 'mat-1',
          description: 'Board',
          qtyOrdered: 400,
          qtyReceived: 100,
          uom: 'SHEET',
          unitCost: 2,
        },
      ],
    });

    await s2.receive(tenantId, 'po-1', actorId, {
      lines: [{ purchaseOrderLineId: 'pol-1', qtyReceived: 300 }],
    });

    // 100 @ 1.00 + 300 @ 2.00 = 1.75, not the 1.50 midpoint.
    expect(stock2[0].qtyOnHand).toBe(400);
    expect(stock2[0].avgUnitCost).toBe(1.75);
  });

  it('credits GRNI with exactly qty × ordered price, not the rounded stock-value change', async () => {
    // Reproduces staging: 1000 @ 0.30 onto 1050 already on hand at 0.5057.
    // The change in qty × a four-place average came to 299.91, stranding 0.09
    // in GRNI that no bill could ever clear.
    const { service, journals } = makeService({
      stock: [
        {
          id: 'stock-1',
          tenantId,
          materialId: 'mat-1',
          locationId,
          qtyOnHand: 1050,
          qtyReserved: 0,
          qtyOnOrder: 0,
          avgUnitCost: 0.5057,
          reorderPoint: null,
          reorderQty: null,
        },
      ],
      orderLines: [
        {
          id: 'pol-1',
          tenantId,
          purchaseOrderId: 'po-1',
          materialId: 'mat-1',
          description: 'Board',
          qtyOrdered: 1000,
          qtyReceived: 0,
          uom: 'SHEET',
          unitCost: 0.3,
        },
      ],
    });

    await service.receive(tenantId, 'po-1', actorId, {
      lines: [{ purchaseOrderLineId: 'pol-1', qtyReceived: 1000 }],
    });

    const grni = journals[0].lines.find((l: any) => l.role === 'GRNI');
    expect(grni.credit).toBe(300);
    expect(journals[0].totalAmount).toBe(300);
  });

  it('moves the order to PARTIALLY_RECEIVED on a short delivery', async () => {
    const { service, order } = makeService();

    await service.receive(tenantId, 'po-1', actorId, {
      lines: [{ purchaseOrderLineId: 'pol-1', qtyReceived: 200 }],
    });

    expect(order.status).toBe('PARTIALLY_RECEIVED');
  });

  it('moves the order to RECEIVED when every line is complete', async () => {
    const { service, order } = makeService();

    await service.receive(tenantId, 'po-1', actorId, {
      lines: [{ purchaseOrderLineId: 'pol-1', qtyReceived: 500 }],
    });

    expect(order.status).toBe('RECEIVED');
  });

  it('refuses an over-delivery when no tolerance is set', async () => {
    const { service } = makeService();

    await expect(
      service.receive(tenantId, 'po-1', actorId, {
        lines: [{ purchaseOrderLineId: 'pol-1', qtyReceived: 501 }],
      }),
    ).rejects.toThrow(/exceeds the 500 still outstanding/);
  });

  it('accepts an over-delivery inside the tenant tolerance', async () => {
    // Suppliers routinely send a little over; without a tolerance every one of
    // those would need an order amendment before the goods could be booked in.
    const { service, stock } = makeService({ tolerance: 0.05 });

    await service.receive(tenantId, 'po-1', actorId, {
      lines: [{ purchaseOrderLineId: 'pol-1', qtyReceived: 525 }],
    });

    expect(stock[0].qtyOnHand).toBe(525);
  });

  it('refuses to receive against a draft order', async () => {
    // Booking in stock nobody authorised buying is how a shop ends up owning
    // something it never agreed to pay for.
    const { service } = makeService({ orderStatus: 'DRAFT' });

    await expect(
      service.receive(tenantId, 'po-1', actorId, {
        lines: [{ purchaseOrderLineId: 'pol-1', qtyReceived: 10 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a line that is not on the order', async () => {
    const { service } = makeService();

    await expect(
      service.receive(tenantId, 'po-1', actorId, {
        lines: [{ purchaseOrderLineId: 'pol-nope', qtyReceived: 10 }],
      }),
    ).rejects.toThrow(/is not on PO-2026-0001/);
  });

  it('will not touch another tenant’s order', async () => {
    const { service } = makeService();

    await expect(
      service.receive('22222222-2222-2222-2222-222222222222', 'po-1', actorId, {
        lines: [{ purchaseOrderLineId: 'pol-1', qtyReceived: 10 }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('records a free-text line without moving stock', async () => {
    // A delivery charge has nothing to put on a shelf, but it is still
    // received and still owed for.
    const { service, stock, journals } = makeService({
      orderLines: [
        {
          id: 'pol-1',
          tenantId,
          purchaseOrderId: 'po-1',
          materialId: null,
          description: 'Delivery charge',
          qtyOrdered: 1,
          qtyReceived: 0,
          uom: 'EACH',
          unitCost: 25,
        },
      ],
    });

    await service.receive(tenantId, 'po-1', actorId, {
      lines: [{ purchaseOrderLineId: 'pol-1', qtyReceived: 1 }],
    });

    expect(stock).toHaveLength(0);
    expect(journals[0].totalAmount).toBe(25);
  });
});

describe('InventoryService.adjust', () => {
  const withStock = () => ({
    stock: [
      {
        id: 'stock-1',
        tenantId,
        materialId: 'mat-1',
        locationId,
        qtyOnHand: 100,
        qtyReserved: 0,
        qtyOnOrder: 0,
        avgUnitCost: 2,
        reorderPoint: null,
        reorderQty: null,
      },
    ],
  });

  it('writes stock off and posts the loss to cost of sales', async () => {
    const { service, stock, journals } = makeService(withStock());

    await service.adjust(tenantId, actorId, {
      materialId: 'mat-1',
      qtyDelta: -10,
      note: 'Water damage',
    });

    expect(stock[0].qtyOnHand).toBe(90);
    expect(journals[0].lines[0].ledgerAccountCode).toBe('5000');
    expect(journals[0].totalAmount).toBe(20);
  });

  it('requires a reason', async () => {
    const { service } = makeService(withStock());

    await expect(
      service.adjust(tenantId, actorId, {
        materialId: 'mat-1',
        qtyDelta: -5,
        note: '  ',
      }),
    ).rejects.toThrow(/reason/i);
  });

  it('refuses an adjustment of zero', async () => {
    const { service } = makeService(withStock());

    await expect(
      service.adjust(tenantId, actorId, {
        materialId: 'mat-1',
        qtyDelta: 0,
        note: 'x',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('records the adjustment as a movement, never an edit', async () => {
    const { service, movements } = makeService(withStock());

    await service.adjust(tenantId, actorId, {
      materialId: 'mat-1',
      qtyDelta: -10,
      note: 'Stock count',
    });

    expect(movements).toHaveLength(1);
    expect(movements[0].type).toBe('ADJUSTMENT');
    expect(movements[0].note).toBe('Stock count');
    expect(movements[0].actorId).toBe(actorId);
  });
});
