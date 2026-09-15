import { BadRequestException, ConflictException } from '@nestjs/common';
import { isBalanced } from '@saas/shared';
import { ProductionService } from './production.service';

const tenantId = '11111111-1111-1111-1111-111111111111';

/**
 * In-memory stand-in for the repositories and query builders the service
 * touches. Rows live per entity name; `where` objects match on equality or
 * a TypeORM `In(...)`.
 */
function makeWorld() {
  const tables: Record<string, any[]> = {
    WorkOrder: [],
    WorkOrderOperation: [],
    WorkOrderMaterial: [],
    SalesOrder: [],
    SalesOrderLine: [],
    Quote: [],
    JournalEntry: [],
  };
  let nextId = 1;
  let sequence = 0;

  const matches = (row: any, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' && '_type' in v && v._type === 'in'
        ? (v._value as unknown[]).includes(row[k])
        : row[k] === v,
    );

  const repo = (name: string) => ({
    findOne: async ({ where }: any) =>
      tables[name].find((r) => matches(r, where)) ?? null,
    find: async ({ where }: any = {}) =>
      tables[name].filter((r) => matches(r, where)),
    create: (dto: any) => ({ ...dto }),
    save: async (rows: any) => {
      for (const row of Array.isArray(rows) ? rows : [rows]) {
        if (!row.id) {
          row.id = `${name}-${nextId++}`;
          row.createdAt = new Date();
          row.qtyIssued ??= 0;
          row.qtyReturned ??= 0;
          row.valueIssued ??= 0;
          row.actualMinutes ??= 0;
          tables[name].push(row);
        }
      }
      return rows;
    },
    update: async (where: any, patch: any) => {
      tables[name]
        .filter((r) => matches(r, where))
        .forEach((r) => Object.assign(r, patch));
    },
    createQueryBuilder: () => {
      const params: Record<string, any> = {};
      const qb: any = {
        setLock: () => qb,
        where: (_: string, p: any = {}) => (Object.assign(params, p), qb),
        andWhere: (_: string, p: any = {}) => (Object.assign(params, p), qb),
        getOne: async () =>
          tables[name].find((r) =>
            name === 'WorkOrderMaterial'
              ? r.id === params.mid && r.workOrderId === params.wid
              : r.id === params.id && r.tenantId === params.tenantId,
          ) ?? null,
      };
      return qb;
    },
  });

  const manager: any = {
    getRepository: (entity: { name: string }) => repo(entity.name),
    query: async () => [{ current_value: ++sequence }],
  };
  const dataSource: any = { transaction: (cb: any) => cb(manager) };

  const ledger = {
    resolveLines: jest.fn(async (_t: string, lines: any[]) =>
      lines.map((l) => ({
        ledgerAccountId: l.role,
        ledgerAccountCode: '0',
        ...l,
      })),
    ),
  };

  // Stock at a moving average of 0.50 per sheet.
  const stock = { qty: 1000, avg: 0.5 };
  const inventory = {
    moveForWorkOrder: jest.fn(async (_m: any, p: any) => {
      if (p.qty > stock.qty)
        throw new BadRequestException(`Only ${stock.qty} on hand`);
      stock.qty -= p.qty;
      const value =
        p.qty > 0
          ? Math.round(p.qty * stock.avg * 100) / 100
          : Math.round(Math.abs(p.qty) * p.returnUnitCost * 100) / 100;
      return { movement: { id: `mv-${nextId++}` }, value };
    }),
  };

  const costing = {
    breakdownForTemplate: jest.fn(async () => ({
      template: {
        id: 'tpl-1',
        templateKey: 'rigid-box',
        name: 'Rigid box',
        version: 3,
        pricing: { overheadPct: 0.1 },
      },
      catalog: {
        workCenters: {
          press: { machineCostPerHour: 40, laborCostPerHour: 20 },
          wrap: { machineCostPerHour: 0, laborCostPerHour: 18 },
        },
      },
      breakdown: {
        materialCost: 50,
        machineCost: 40,
        laborCost: 38,
        amortizedToolingCost: 12,
        overheadCost: 14,
        totalCost: 154,
        unitCost: 1.54,
        operations: [
          {
            key: 'wrap',
            label: 'Hand wrap',
            workCenterId: 'wrap',
            workCenterName: 'Wrapping bench',
            sequence: 20,
            setupMinutes: 0,
            runMinutes: 60,
            chargedMinutes: 60,
          },
          {
            key: 'print',
            label: 'Print',
            workCenterId: 'press',
            workCenterName: 'Press',
            sequence: 10,
            setupMinutes: 15,
            runMinutes: 45,
            chargedMinutes: 60,
          },
        ],
        materials: [
          {
            materialId: 'board',
            materialName: 'Greyboard',
            uom: 'SHEET',
            purchaseUnits: 60,
            unitCost: 0.5,
          },
          {
            materialId: 'board',
            materialName: 'Greyboard',
            uom: 'SHEET',
            purchaseUnits: 40,
            unitCost: 0.5,
          },
        ],
      },
    })),
  };

  const service = new ProductionService(
    repo('WorkOrder') as any,
    repo('WorkOrderOperation') as any,
    repo('WorkOrderMaterial') as any,
    repo('SalesOrder') as any,
    repo('SalesOrderLine') as any,
    repo('Quote') as any,
    costing as any,
    inventory as any,
    ledger as any,
    dataSource,
  );

  tables.Quote.push({
    id: 'q1',
    tenantId,
    items: [
      {
        id: 'tpl-line',
        type: 'product',
        templateId: 'tpl-1',
        parameters: { w: 200 },
        cost: { unitCost: 1.5 },
      },
      { id: 'manual-line', type: 'product', description: 'Rush fee' },
    ],
  });
  tables.SalesOrder.push({
    id: 'so1',
    tenantId,
    quoteId: 'q1',
    orderNumber: 'SO-2026-0001',
    status: 'OPEN',
    customerName: 'Acme',
  });
  tables.SalesOrderLine.push(
    {
      id: 'sol1',
      tenantId,
      salesOrderId: 'so1',
      sequence: 1,
      quoteLineId: 'tpl-line',
      description: 'Rigid box',
      qtyOrdered: 100,
    },
    {
      id: 'sol2',
      tenantId,
      salesOrderId: 'so1',
      sequence: 2,
      quoteLineId: 'manual-line',
      description: 'Rush fee',
      qtyOrdered: 1,
    },
  );

  return { service, tables, stock, inventory, ledger, costing };
}

async function planned(w: ReturnType<typeof makeWorld>) {
  const result = await w.service.createFromSalesOrder(tenantId, 'u1', 'so1', {
    salesOrderLineIds: null,
    dueDate: null,
  });
  return { result, wo: w.tables.WorkOrder[0] };
}

async function released(w: ReturnType<typeof makeWorld>) {
  const { wo } = await planned(w);
  await w.service.release(tenantId, wo.id);
  return wo;
}

describe('ProductionService.createFromSalesOrder', () => {
  it('plans template lines from the engine, and skips lines with no routing, saying why', async () => {
    const w = makeWorld();
    const { result, wo } = await planned(w);

    expect(result.created).toHaveLength(1);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        salesOrderLineId: 'sol2',
        reason: expect.stringMatching(/no routing/),
      }),
    ]);
    expect(wo.woNumber).toMatch(/^WO-\d{4}-0001$/);
    expect(wo.templateVersion).toBe(3);
    expect(wo.quotedUnitCost).toBe(1.5);
    expect(wo.overheadPct).toBe(0.1);

    // Routing in engine sequence, with the rates snapshotted.
    const ops = w.tables.WorkOrderOperation;
    expect(
      ops.map((o) => [
        o.sequence,
        o.label,
        o.machineCostPerHour,
        o.laborCostPerHour,
      ]),
    ).toEqual([
      [1, 'Print', 40, 20],
      [2, 'Hand wrap', 0, 18],
    ]);
    // Two lines drawing on the same board become one material row.
    expect(w.tables.WorkOrderMaterial).toEqual([
      expect.objectContaining({ materialId: 'board', qtyPlanned: 100 }),
    ]);
  });

  it('does not plan a line twice', async () => {
    const w = makeWorld();
    await planned(w);
    const again = await w.service.createFromSalesOrder(tenantId, 'u1', 'so1', {
      salesOrderLineIds: null,
      dueDate: null,
    });
    expect(again.created).toHaveLength(0);
    expect(again.skipped.map((s) => s.reason)).toContain(
      'Already has a work order',
    );
  });
});

describe('ProductionService shop floor', () => {
  it('refuses floor actions before release', async () => {
    const w = makeWorld();
    const { wo } = await planned(w);
    const op = w.tables.WorkOrderOperation[0];
    await expect(
      w.service.startOperation(tenantId, wo.id, op.id, 'u1'),
    ).rejects.toThrow(/not been released/);
  });

  it('accumulates timer sessions, and caps one left running overnight', async () => {
    const w = makeWorld();
    const wo = await released(w);
    const op = w.tables.WorkOrderOperation[0];

    await w.service.startOperation(tenantId, wo.id, op.id, 'u1');
    expect(wo.status).toBe('IN_PROGRESS');
    op.runningSince = new Date(Date.now() - 25 * 60 * 1000);
    await w.service.stopOperation(tenantId, wo.id, op.id, false);
    expect(op.actualMinutes).toBeCloseTo(25, 0);
    expect(op.status).toBe('PAUSED');

    await w.service.startOperation(tenantId, wo.id, op.id, 'u1');
    op.runningSince = new Date(Date.now() - 20 * 60 * 60 * 1000);
    const { capped } = await w.service.stopOperation(
      tenantId,
      wo.id,
      op.id,
      true,
    );
    expect(capped).toBe(true);
    expect(op.actualMinutes).toBeCloseTo(25 + 720, 0);
    expect(op.status).toBe('DONE');
  });

  it('issues material into WIP at the moving average: Dr WIP, Cr Inventory', async () => {
    const w = makeWorld();
    const wo = await released(w);
    const mat = w.tables.WorkOrderMaterial[0];

    await w.service.issueMaterial(
      tenantId,
      wo.id,
      'u1',
      { workOrderMaterialId: mat.id, qty: 100 },
      true,
    );

    expect(mat.qtyIssued).toBe(100);
    expect(mat.valueIssued).toBe(50);
    const [entry] = w.tables.JournalEntry;
    expect(entry.referenceType).toBe('WORK_ORDER');
    expect(entry.lines.map((l: any) => [l.role, l.debit, l.credit])).toEqual([
      ['WIP', 50, 0],
      ['INVENTORY', 0, 50],
    ]);
    expect(isBalanced(entry.lines)).toBe(true);
  });

  it('returns part, then all, leaving WIP at exactly zero', async () => {
    const w = makeWorld();
    const wo = await released(w);
    const mat = w.tables.WorkOrderMaterial[0];
    await w.service.issueMaterial(
      tenantId,
      wo.id,
      'u1',
      { workOrderMaterialId: mat.id, qty: 3 },
      true,
    );
    // 3 × 0.5 = 1.50; a third is 0.50, and rounding a third at a time must not strand a cent.
    await w.service.issueMaterial(
      tenantId,
      wo.id,
      'u1',
      { workOrderMaterialId: mat.id, qty: -1 },
      true,
    );
    expect(mat.valueIssued).toBe(1);
    await w.service.issueMaterial(
      tenantId,
      wo.id,
      'u1',
      { workOrderMaterialId: mat.id, qty: -2 },
      true,
    );

    expect(mat.valueIssued).toBe(0);
    expect(mat.qtyReturned).toBe(3);
    const wip = w.tables.JournalEntry.flatMap((e) => e.lines).filter(
      (l: any) => l.role === 'WIP',
    );
    expect(
      wip.reduce((sum: number, l: any) => sum + l.debit - l.credit, 0),
    ).toBeCloseTo(0, 10);
  });

  it('refuses to return more than is on the job', async () => {
    const w = makeWorld();
    const wo = await released(w);
    const mat = w.tables.WorkOrderMaterial[0];
    await w.service.issueMaterial(
      tenantId,
      wo.id,
      'u1',
      { workOrderMaterialId: mat.id, qty: 10 },
      true,
    );
    await expect(
      w.service.issueMaterial(
        tenantId,
        wo.id,
        'u1',
        { workOrderMaterialId: mat.id, qty: -11 },
        true,
      ),
    ).rejects.toThrow(/Only 10/);
  });
});

describe('ProductionService.complete', () => {
  it('refuses while a timer is running', async () => {
    const w = makeWorld();
    const wo = await released(w);
    const op = w.tables.WorkOrderOperation[0];
    await w.service.startOperation(tenantId, wo.id, op.id, 'u1');
    await expect(
      w.service.complete(tenantId, wo.id, 'u1', { qtyCompleted: null }, true),
    ).rejects.toThrow(/still running/);
  });

  it('costs the job from actuals, skips untouched operations, and posts WIP to cost of sales', async () => {
    const w = makeWorld();
    const wo = await released(w);
    const [print, wrap] = w.tables.WorkOrderOperation;
    const mat = w.tables.WorkOrderMaterial[0];

    await w.service.logTime(tenantId, wo.id, print.id, 'u1', 90);
    await w.service.issueMaterial(
      tenantId,
      wo.id,
      'u1',
      { workOrderMaterialId: mat.id, qty: 120 },
      true,
    );
    await w.service.complete(tenantId, wo.id, 'u2', { qtyCompleted: 95 }, true);

    expect(print.status).toBe('DONE');
    expect(wrap.status).toBe('SKIPPED');
    expect(wo.status).toBe('COMPLETE');
    // material 60, machine 1.5h×40=60, labour 1.5h×20=30, tooling 12 → 162, overhead 16.20
    expect(wo.actualCost).toEqual({
      material: 60,
      machine: 60,
      labor: 30,
      tooling: 12,
      overhead: 16.2,
      total: 178.2,
      unit: 1.8758,
    });

    const done = w.tables.JournalEntry.find((e) =>
      e.entryNumber.endsWith('-DONE'),
    );
    expect(done.lines.map((l: any) => [l.role, l.debit, l.credit])).toEqual([
      ['COGS', 60, 0],
      ['WIP', 0, 60],
    ]);
  });

  it('will not complete twice or complete a cancelled job', async () => {
    const w = makeWorld();
    const wo = await released(w);
    await w.service.complete(
      tenantId,
      wo.id,
      'u1',
      { qtyCompleted: null },
      true,
    );
    await expect(
      w.service.complete(tenantId, wo.id, 'u1', { qtyCompleted: null }, true),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('will not cancel a job with material still on it', async () => {
    const w = makeWorld();
    const wo = await released(w);
    const mat = w.tables.WorkOrderMaterial[0];
    await w.service.issueMaterial(
      tenantId,
      wo.id,
      'u1',
      { workOrderMaterialId: mat.id, qty: 5 },
      true,
    );
    await expect(w.service.cancel(tenantId, wo.id, null)).rejects.toThrow(
      /Return Greyboard/,
    );
  });
});
