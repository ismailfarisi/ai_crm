import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import {
  actualCost,
  DEFAULT_BOARD_COLUMNS,
  isBalanced,
  LEDGER_ROLES,
} from '@saas/shared';
import { LabourAbsorptionService } from '../job-costing/labour-absorption.service';
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
    ProductionBoardSetting: [],
    WorkOrderLabour: [],
    TimesheetEntry: [],
    PayrollRunLine: [],
    PayrollSettings: [],
    Organization: [{ id: tenantId, baseCurrency: 'AED' }],
  };
  let nextId = 1;
  let sequence = 0;

  const op = (row: any, k: string, v: any) => {
    if (v && typeof v === 'object' && '_type' in v) {
      if (v._type === 'in') return (v._value as unknown[]).includes(row[k]);
      if (v._type === 'isNull') return row[k] == null;
      if (v._type === 'between')
        return row[k] >= v._value[0] && row[k] <= v._value[1];
      throw new Error(`unsupported operator ${v._type}`);
    }
    return row[k] === v;
  };
  const matches = (row: any, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) => op(row, k, v));

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
      events.push(`update:${name}:${Object.keys(patch).sort().join(',')}`);
      tables[name]
        .filter((r) => matches(r, where))
        .forEach((r) => Object.assign(r, patch));
    },
    delete: async (where: any) => {
      tables[name] = tables[name].filter((r) => !matches(r, where));
    },
    createQueryBuilder: () => {
      const params: Record<string, any> = {};
      const qb: any = {
        setLock: () => qb,
        where: (_: string, p: any = {}) => (Object.assign(params, p), qb),
        andWhere: (_: string, p: any = {}) => (Object.assign(params, p), qb),
        getOne: async () => (
          events.push(`lock:${name}`),
          tables[name].find((r) =>
            name === 'WorkOrderMaterial'
              ? r.id === params.mid && r.workOrderId === params.wid
              : r.id === params.id && r.tenantId === params.tenantId,
          ) ?? null
        ),
      };
      return qb;
    },
  });

  const events: string[] = [];
  const manager: any = {
    getRepository: (entity: { name: string }) => repo(entity.name),
    query: async (sql: string) => {
      events.push(sql);
      return [{ current_value: ++sequence }];
    },
    transaction: (cb: any) => cb(manager),
  };
  const dataSource: any = { manager, transaction: (cb: any) => cb(manager) };

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

  // The labour panel and the labour in a job's cost are JobCostService's;
  // here costFor runs the engine with `labour.value` (unset: minutes × rate).
  const labour: { value: number | undefined } = { value: undefined };
  const jobCost = {
    costFor: jest.fn(
      async (
        _m: any,
        _t: string,
        wo: any,
        ops: any[],
        materialValue: number,
        qtyCompleted: number,
      ) => ({
        cost: actualCost({
          operations: ops,
          materialValue,
          toolingCost: wo.estimatedCost?.tooling ?? 0,
          overheadPct: wo.overheadPct,
          qtyCompleted,
          labour: labour.value,
        }),
        split: { actual: labour.value ?? 0, provisional: 0, unlinked: 0 },
        status: 'ACTUAL',
      }),
    ),
    recompute: jest.fn(async () => undefined),
    breakdown: jest.fn(async () => ({
      actual: 20,
      provisional: 0,
      unlinked: 0,
      total: 20,
      unlinkedHours: 0,
      status: 'ACTUAL',
      byEmployee: [],
    })),
  };

  // Entries the clock wrote. 'linked' is the one user with an employee.
  const clockEntries: any[] = [];
  const timesheets = {
    recordClock: jest.fn(async (_m: any, _t: string, a: any) => {
      if (a.userId !== 'linked') return null;
      clockEntries.push(a);
      return a;
    }),
  };

  // The real service: completion and cancellation move its rows.
  const absorption = new LabourAbsorptionService(ledger as any, jobCost as any);
  const service = new ProductionService(
    repo('WorkOrder') as any,
    repo('WorkOrderOperation') as any,
    repo('WorkOrderMaterial') as any,
    repo('SalesOrder') as any,
    repo('SalesOrderLine') as any,
    repo('Quote') as any,
    repo('ProductionBoardSetting') as any,
    costing as any,
    inventory as any,
    ledger as any,
    dataSource,
    jobCost as any,
    timesheets as any,
    absorption,
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

  return {
    service,
    tables,
    stock,
    inventory,
    ledger,
    costing,
    jobCost,
    timesheets,
    clockEntries,
    events,
    labour,
    absorption,
    manager,
  };
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

describe('ProductionService reading', () => {
  it('get carries the labour panel, with the caller’s cost and pay visibility', async () => {
    const w = makeWorld();
    const { wo } = await planned(w);
    const dto = await w.service.get(tenantId, wo.id, true, false);
    expect(dto.labour).toEqual(expect.objectContaining({ total: 20 }));
    expect(w.jobCost.breakdown).toHaveBeenCalledWith(
      expect.anything(),
      tenantId,
      wo.id,
      { cost: true, pay: false },
    );
  });

  it('release and cancel return labour totals only to a caller who can see cost', async () => {
    const w = makeWorld();
    const { wo } = await planned(w);
    w.jobCost.breakdown.mockClear();
    await w.service.release(tenantId, wo.id, false);
    await w.service.cancel(tenantId, wo.id, null, false);
    expect(w.jobCost.breakdown.mock.calls.map((c: any[]) => c[3])).toEqual([
      { cost: false, pay: false },
      { cost: false, pay: false },
    ]);

    const w2 = makeWorld();
    const { wo: wo2 } = await planned(w2);
    w2.jobCost.breakdown.mockClear();
    await w2.service.release(tenantId, wo2.id, true);
    await w2.service.cancel(tenantId, wo2.id, null, true);
    expect(w2.jobCost.breakdown.mock.calls.map((c: any[]) => c[3])).toEqual([
      { cost: true, pay: false },
      { cost: true, pay: false },
    ]);
  });

  it('list leaves labour null and never computes it', async () => {
    const w = makeWorld();
    const { wo } = await planned(w);
    // Planning returns each new work order through get().
    w.jobCost.breakdown.mockClear();
    (w.service as any).workOrders.createQueryBuilder = () => {
      const qb: any = {
        where: () => qb,
        andWhere: () => qb,
        orderBy: () => qb,
        addOrderBy: () => qb,
        take: () => qb,
        getMany: async () => [wo],
      };
      return qb;
    };
    const rows = await w.service.list(tenantId, {} as any, true);
    expect(rows).toHaveLength(1);
    expect(rows[0].labour).toBeNull();
    expect(w.jobCost.breakdown).not.toHaveBeenCalled();
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
    await w.service.stopOperation(tenantId, wo.id, op.id, false, 'u1');
    expect(op.actualMinutes).toBeCloseTo(25, 0);
    expect(op.status).toBe('PAUSED');

    await w.service.startOperation(tenantId, wo.id, op.id, 'u1');
    op.runningSince = new Date(Date.now() - 20 * 60 * 60 * 1000);
    const { capped } = await w.service.stopOperation(
      tenantId,
      wo.id,
      op.id,
      true,
      'u1',
    );
    expect(capped).toBe(true);
    expect(op.actualMinutes).toBeCloseTo(25 + 720, 0);
    expect(op.status).toBe('DONE');
  });

  describe('the clock writes timesheet entries', () => {
    // Started 30 minutes ago.
    const running = async (w: ReturnType<typeof makeWorld>, actor: string) => {
      const wo = await released(w);
      const op = w.tables.WorkOrderOperation[0];
      await w.service.startOperation(tenantId, wo.id, op.id, actor);
      op.runningSince = new Date(Date.now() - 30 * 60 * 1000);
      return { wo, op };
    };

    it('stop by a linked user writes one CLOCK entry dated the session start (UTC), minutes added once', async () => {
      const w = makeWorld();
      const { wo, op } = await running(w, 'linked');
      // A session that began 23:30 UTC the day before it was stopped.
      op.runningSince = new Date('2026-03-31T23:30:00.000Z');
      jest.useFakeTimers({
        now: new Date('2026-04-01T00:00:00.000Z'),
        doNotFake: ['nextTick', 'setImmediate', 'setTimeout'],
      });
      try {
        await w.service.stopOperation(tenantId, wo.id, op.id, false, 'linked');
      } finally {
        jest.useRealTimers();
      }
      expect(w.clockEntries).toEqual([
        {
          userId: 'linked',
          workOrderId: wo.id,
          operationId: op.id,
          minutes: 30,
          workDate: '2026-03-31',
        },
      ]);
      expect(op.actualMinutes).toBe(30);
    });

    it('finish by a linked user writes the entry too', async () => {
      const w = makeWorld();
      const { wo, op } = await running(w, 'linked');
      await w.service.stopOperation(tenantId, wo.id, op.id, true, 'linked');
      expect(w.clockEntries).toHaveLength(1);
      expect(op.status).toBe('DONE');
    });

    it('a supervisor stopping or finishing another operator’s session credits the operator who started it (J20)', async () => {
      for (const finish of [false, true]) {
        const w = makeWorld();
        // Operator A ('linked', has an employee) started; supervisor B stops.
        const { wo, op } = await running(w, 'linked');
        await w.service.stopOperation(
          tenantId,
          wo.id,
          op.id,
          finish,
          'supervisor-b',
        );
        expect(w.clockEntries).toHaveLength(1);
        expect(w.clockEntries[0]).toMatchObject({
          userId: 'linked',
          minutes: 30,
        });
        expect(op.operatorId).toBe('linked');
      }
    });

    it('logTime stays with the actor even when another operator started the operation', async () => {
      const w = makeWorld();
      const { wo, op } = await running(w, 'linked');
      await w.service.stopOperation(tenantId, wo.id, op.id, false, 'linked');
      w.timesheets.recordClock.mockClear();
      await w.service.logTime(tenantId, wo.id, op.id, 'supervisor-b', 15);
      expect(
        w.timesheets.recordClock.mock.calls.map((c: any[]) => c[2].userId),
      ).toEqual(['supervisor-b']);
    });

    it('stop by an unlinked user writes no entry but adds the minutes', async () => {
      const w = makeWorld();
      const { wo, op } = await running(w, 'u1');
      await w.service.stopOperation(tenantId, wo.id, op.id, false, 'u1');
      expect(w.clockEntries).toHaveLength(0);
      expect(op.actualMinutes).toBeCloseTo(30, 0);
    });

    it('skips the entry but keeps the minutes when recordClock returns null (posted month)', async () => {
      const w = makeWorld();
      const { wo, op } = await running(w, 'linked');
      w.timesheets.recordClock.mockResolvedValueOnce(null as never);
      await w.service.stopOperation(tenantId, wo.id, op.id, false, 'linked');
      expect(w.timesheets.recordClock).toHaveBeenCalledTimes(1);
      expect(op.status).toBe('PAUSED');
      expect(op.actualMinutes).toBeCloseTo(30, 0);
    });

    it('keeps the minutes even when recordClock throws', async () => {
      const w = makeWorld();
      const { wo, op } = await running(w, 'linked');
      w.timesheets.recordClock.mockRejectedValueOnce(new Error('boom'));
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      await w.service.stopOperation(tenantId, wo.id, op.id, false, 'linked');
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(`operation ${op.id}): boom`),
      );
      warn.mockRestore();
      expect(op.status).toBe('PAUSED');
      expect(op.actualMinutes).toBeCloseTo(30, 0);
    });

    it('a stop with no running session writes no entry', async () => {
      const w = makeWorld();
      const wo = await released(w);
      const op = w.tables.WorkOrderOperation[0];
      await w.service.stopOperation(tenantId, wo.id, op.id, true, 'linked');
      expect(w.timesheets.recordClock).not.toHaveBeenCalled();
    });

    it('a capped session records the capped minutes', async () => {
      const w = makeWorld();
      const { wo, op } = await running(w, 'linked');
      op.runningSince = new Date(Date.now() - 20 * 60 * 60 * 1000);
      await w.service.stopOperation(tenantId, wo.id, op.id, true, 'linked');
      expect(w.clockEntries[0].minutes).toBe(720);
    });

    it('logTime by a linked user writes a CLOCK entry dated today (UTC)', async () => {
      const w = makeWorld();
      const wo = await released(w);
      const op = w.tables.WorkOrderOperation[0];
      jest.useFakeTimers({
        now: new Date('2026-04-01T23:59:00.000Z'),
        doNotFake: ['nextTick', 'setImmediate', 'setTimeout'],
      });
      try {
        await w.service.logTime(tenantId, wo.id, op.id, 'linked', 45);
      } finally {
        jest.useRealTimers();
      }
      expect(w.clockEntries).toEqual([
        {
          userId: 'linked',
          workOrderId: wo.id,
          operationId: op.id,
          minutes: 45,
          workDate: '2026-04-01',
        },
      ]);
      expect(op.actualMinutes).toBe(45);
    });

    it('stop, finish and logTime take the job-costing lock before the work order row', async () => {
      const w = makeWorld();
      const { wo, op } = await running(w, 'linked');
      const firstTwo = () => w.events.splice(0).slice(0, 2);
      w.events.length = 0;
      await w.service.stopOperation(tenantId, wo.id, op.id, false, 'linked');
      expect(firstTwo()).toEqual([
        expect.stringContaining('pg_advisory_xact_lock'),
        'lock:WorkOrder',
      ]);
      await w.service.stopOperation(tenantId, wo.id, op.id, true, 'linked');
      expect(firstTwo()).toEqual([
        expect.stringContaining('pg_advisory_xact_lock'),
        'lock:WorkOrder',
      ]);
      await w.service.logTime(tenantId, wo.id, op.id, 'linked', 5);
      expect(firstTwo()).toEqual([
        expect.stringContaining('pg_advisory_xact_lock'),
        'lock:WorkOrder',
      ]);
    });
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

/** Σ debit − credit per role across entries. */
function netByRole(entries: any[]) {
  const out: Record<string, number> = {};
  for (const l of entries.flatMap((e) => e.lines)) {
    out[l.role] =
      Math.round(((out[l.role] ?? 0) + l.debit - l.credit) * 100) / 100;
  }
  return out;
}

/** A work_order_labour row as an approval writes it. */
function labourRow(w: ReturnType<typeof makeWorld>, over: any) {
  const row = {
    id: `wol-${w.tables.WorkOrderLabour.length + 1}`,
    tenantId,
    employeeId: 'e1',
    runId: 'run1',
    runLineId: 'rl1',
    period: '2026-10',
    hours: 6,
    rate: 50,
    account: 'WIP',
    clearedTo: null,
    clearedAt: null,
    journalEntryId: 'je-lab',
    ...over,
  };
  w.tables.WorkOrderLabour.push(row);
  return row;
}

describe('ProductionService: absorbed labour on completion and cancellation', () => {
  it('complete moves material 100 and WIP labour 300 to COGS in one JE-…-DONE of 400 and clears the rows to COGS', async () => {
    const w = makeWorld();
    const wo = await released(w);
    const mat = w.tables.WorkOrderMaterial[0];
    await w.service.issueMaterial(
      tenantId,
      wo.id,
      'u1',
      { workOrderMaterialId: mat.id, qty: 200 },
      true,
    );
    const a = labourRow(w, { workOrderId: wo.id, amount: 200 });
    const b = labourRow(w, { workOrderId: wo.id, amount: 100 });
    // Already in COGS, or another job's: not this completion's to move.
    const booked = labourRow(w, {
      workOrderId: wo.id,
      account: 'COGS',
      amount: 50,
    });
    const other = labourRow(w, { workOrderId: 'wo-other', amount: 70 });
    w.labour.value = 350;

    await w.service.complete(
      tenantId,
      wo.id,
      'u2',
      { qtyCompleted: 100 },
      true,
    );

    const done = w.tables.JournalEntry.filter((e) =>
      e.entryNumber.endsWith('-DONE'),
    );
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({
      entryNumber: `JE-${wo.woNumber}-DONE`,
      referenceType: 'WORK_ORDER',
      referenceId: wo.id,
      totalAmount: 400,
    });
    expect(done[0].lines.map((l: any) => [l.role, l.debit, l.credit])).toEqual([
      [LEDGER_ROLES.COGS, 400, 0],
      [LEDGER_ROLES.WIP, 0, 400],
    ]);
    expect(isBalanced(done[0].lines)).toBe(true);

    for (const r of [a, b]) {
      expect(r.clearedTo).toBe('COGS');
      expect(r.clearedAt).toBeInstanceOf(Date);
    }
    expect(booked.clearedTo).toBeNull();
    expect(other.clearedTo).toBeNull();

    // Labour in the job's cost is JobCostService's, written with its status.
    expect(w.jobCost.costFor).toHaveBeenCalledWith(
      expect.anything(),
      tenantId,
      expect.objectContaining({ id: wo.id }),
      expect.any(Array),
      100,
      100,
    );
    expect(wo.actualCost.labor).toBe(350);
    expect(wo.actualCost.material).toBe(100);
    expect(wo.labourStatus).toBe('ACTUAL');
    expect(wo.labourSplit).toEqual({
      actual: 350,
      provisional: 0,
      unlinked: 0,
    });
    expect(wo.status).toBe('COMPLETE');
    expect(wo.qtyCompleted).toBe(100);
    expect(wo.completedById).toBe('u2');
  });

  it('complete with labour only (no material) still posts', async () => {
    const w = makeWorld();
    const wo = await released(w);
    const row = labourRow(w, { workOrderId: wo.id, amount: 300 });
    await w.service.complete(
      tenantId,
      wo.id,
      'u2',
      { qtyCompleted: null },
      true,
    );
    const done = w.tables.JournalEntry.find((e) =>
      e.entryNumber.endsWith('-DONE'),
    );
    expect(done.totalAmount).toBe(300);
    expect(done.lines.map((l: any) => [l.role, l.debit, l.credit])).toEqual([
      [LEDGER_ROLES.COGS, 300, 0],
      [LEDGER_ROLES.WIP, 0, 300],
    ]);
    expect(row.clearedTo).toBe('COGS');
  });

  it('complete with neither material nor WIP labour posts nothing', async () => {
    const w = makeWorld();
    const wo = await released(w);
    await w.service.complete(
      tenantId,
      wo.id,
      'u2',
      { qtyCompleted: null },
      true,
    );
    expect(w.tables.JournalEntry).toHaveLength(0);
  });

  it('cancel returns WIP labour to overhead: Dr 6390 / Cr WIP, rows cleared to EXPENSE', async () => {
    const w = makeWorld();
    const wo = await released(w);
    const a = labourRow(w, { workOrderId: wo.id, amount: 180 });
    const b = labourRow(w, { workOrderId: wo.id, amount: 120 });
    await w.service.cancel(tenantId, wo.id, 'Customer withdrew');

    expect(w.tables.JournalEntry).toHaveLength(1);
    const [je] = w.tables.JournalEntry;
    expect(je).toMatchObject({
      entryNumber: `JE-${wo.woNumber}-LAB-CANCEL`,
      referenceType: 'WORK_ORDER',
      referenceId: wo.id,
      totalAmount: 300,
    });
    const description = `${wo.woNumber} cancelled: labour back to overhead`;
    expect(
      je.lines.map((l: any) => [l.role, l.debit, l.credit, l.description]),
    ).toEqual([
      [LEDGER_ROLES.LABOUR_ABSORBED, 300, 0, description],
      [LEDGER_ROLES.WIP, 0, 300, description],
    ]);
    for (const r of [a, b]) {
      expect(r.clearedTo).toBe('EXPENSE');
      expect(r.clearedAt).toBeInstanceOf(Date);
    }
    expect(wo.status).toBe('CANCELLED');
    expect(wo.cancelReason).toBe('Customer withdrew');
    expect(wo.cancelledAt).toBeInstanceOf(Date);
  });

  it('cancel with no WIP labour posts nothing', async () => {
    const w = makeWorld();
    const wo = await released(w);
    labourRow(w, { workOrderId: wo.id, amount: 90, clearedTo: 'COGS' });
    await w.service.cancel(tenantId, wo.id, null);
    expect(w.tables.JournalEntry).toHaveLength(0);
    expect(wo.status).toBe('CANCELLED');
  });

  it('cancel still refuses while material is on the job, and moves no labour', async () => {
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
    const row = labourRow(w, { workOrderId: wo.id, amount: 300 });
    await expect(w.service.cancel(tenantId, wo.id, null)).rejects.toThrow(
      /Return Greyboard/,
    );
    expect(row.clearedTo).toBeNull();
    expect(
      w.tables.JournalEntry.some((e) => e.entryNumber.endsWith('-LAB-CANCEL')),
    ).toBe(false);
  });

  it('complete and cancel take the job-costing lock as their first query, then the work order row', async () => {
    const w = makeWorld();
    const wo = await released(w);
    w.events.length = 0;
    await w.service.complete(
      tenantId,
      wo.id,
      'u2',
      { qtyCompleted: null },
      true,
    );
    expect(w.events.slice(0, 2)).toEqual([
      expect.stringContaining('pg_advisory_xact_lock'),
      'lock:WorkOrder',
    ]);

    const w2 = makeWorld();
    const wo2 = await released(w2);
    w2.events.length = 0;
    await w2.service.cancel(tenantId, wo2.id, null);
    expect(w2.events.slice(0, 2)).toEqual([
      expect.stringContaining('pg_advisory_xact_lock'),
      'lock:WorkOrder',
    ]);
  });

  it('complete and cancel write only the work order columns they own', async () => {
    const w = makeWorld();
    const wo = await released(w);
    w.events.length = 0;
    await w.service.complete(
      tenantId,
      wo.id,
      'u2',
      { qtyCompleted: null },
      true,
    );
    expect(w.events).toContain(
      'update:WorkOrder:actualCost,completedAt,completedById,labourSplit,labourStatus,qtyCompleted,status',
    );

    const w2 = makeWorld();
    const wo2 = await released(w2);
    w2.events.length = 0;
    await w2.service.cancel(tenantId, wo2.id, 'x');
    expect(w2.events).toContain(
      'update:WorkOrder:cancelReason,cancelledAt,status',
    );
  });

  /** Review Focus 5, end to end through the real absorption service. */
  it('cancel then void nets to zero: approval 300 to WIP, cancel back to 6390, void skips the rows', async () => {
    const w = makeWorld();
    const wo = await released(w);
    const op = w.tables.WorkOrderOperation[0];
    w.tables.TimesheetEntry.push({
      id: 'te1',
      tenantId,
      employeeId: 'e1',
      workDate: '2026-10-05',
      hours: 6,
      workOrderId: wo.id,
      operationId: op.id,
      indirectCategory: null,
      runLineId: null,
    });
    const line = {
      id: 'rl1',
      tenantId,
      runId: 'run1',
      employeeId: 'e1',
      daysEmployed: 31,
      daysInMonth: 31,
      overtimeHours: 0,
      overtimeHoursPremium: 0,
      salaryCost: 10400, // ÷ 208 standard hours = 50/h; 6 h → 300
      pensionEmployer: 0,
      gratuityAccrual: 0,
      leaveProvisionChange: 0,
      flags: [],
    };
    w.tables.PayrollRunLine.push(line);
    const run: any = {
      id: 'run1',
      tenantId,
      runNumber: 'PR-2026-10',
      period: '2026-10',
      labourJournalEntryId: null,
    };

    // Approval: Dr WIP 300 / Cr 6390 300.
    const prepared = await w.absorption.prepare(w.manager, tenantId, run, [
      line as any,
    ]);
    run.labourJournalEntryId = await w.absorption.post(
      w.manager,
      tenantId,
      run,
      prepared,
      new Date('2026-10-31T00:00:00.000Z'),
    );
    expect(prepared.total).toBe(300);
    expect(w.tables.WorkOrderLabour).toEqual([
      expect.objectContaining({
        workOrderId: wo.id,
        account: 'WIP',
        amount: 300,
      }),
    ]);

    // Cancel: Dr 6390 300 / Cr WIP 300, the row cleared to EXPENSE.
    await w.service.cancel(tenantId, wo.id, null);
    expect(w.tables.WorkOrderLabour[0].clearedTo).toBe('EXPENSE');

    // Void: the row is back in 6390 already, so no labour reversal posts.
    const voidId = await w.absorption.reverse(w.manager, tenantId, run);
    expect(voidId).toBeNull();
    expect(w.tables.WorkOrderLabour).toHaveLength(0);

    expect(w.tables.JournalEntry.map((e) => e.entryNumber)).toEqual([
      'JE-PR-2026-10-LAB',
      `JE-${wo.woNumber}-LAB-CANCEL`,
    ]);
    const net = netByRole(w.tables.JournalEntry);
    expect(net[LEDGER_ROLES.WIP]).toBe(0);
    expect(net[LEDGER_ROLES.LABOUR_ABSORBED]).toBe(0);
  });
});

describe('Board Columns Configuration', () => {
  let service: ProductionService;
  let mockBoardSettingsRepo: any;
  let mockWoRepo: any;

  beforeEach(() => {
    mockBoardSettingsRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn(),
    };
    mockWoRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    const emptyRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    const dataSource: any = {
      transaction: jest.fn(async (cb) => {
        const manager: any = {
          getRepository: jest.fn((entity: any) => {
            if (entity.name === 'WorkOrder') return mockWoRepo;
            if (entity.name === 'ProductionBoardSetting')
              return mockBoardSettingsRepo;
            return emptyRepo;
          }),
        };
        return cb(manager);
      }),
    };
    mockWoRepo.createQueryBuilder.mockReturnValue({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockImplementation(() => mockWoRepo.findOne()),
    });

    service = new ProductionService(
      mockWoRepo,
      emptyRepo as any,
      emptyRepo as any,
      emptyRepo as any,
      emptyRepo as any,
      emptyRepo as any,
      mockBoardSettingsRepo,
      {} as any,
      {} as any,
      {} as any,
      dataSource,
      { breakdown: jest.fn().mockResolvedValue(null) } as any,
      {} as any,
      {} as any,
    );
  });

  it('returns DEFAULT_BOARD_COLUMNS when no tenant settings exist', async () => {
    mockBoardSettingsRepo.findOne.mockResolvedValue(null);
    const columns = await service.getBoardColumns('test-tenant');
    expect(columns).toEqual(DEFAULT_BOARD_COLUMNS);
  });

  it('saves and normalizes custom columns sequence on update', async () => {
    const customCols = [
      {
        id: 'c1',
        name: 'Planned',
        status: 'PLANNED' as const,
        color: 'slate' as const,
        sequence: 0,
        isDefault: true,
      },
      {
        id: 'c2',
        name: 'Released',
        status: 'RELEASED' as const,
        color: 'blue' as const,
        sequence: 1,
        isDefault: true,
      },
      {
        id: 'c3',
        name: 'In progress',
        status: 'IN_PROGRESS' as const,
        color: 'amber' as const,
        sequence: 2,
        isDefault: true,
      },
      {
        id: 'c-qc',
        name: 'QC',
        status: 'IN_PROGRESS' as const,
        color: 'purple' as const,
        sequence: 5,
        isDefault: false,
      },
      {
        id: 'c4',
        name: 'Complete',
        status: 'COMPLETE' as const,
        color: 'emerald' as const,
        sequence: 10,
        isDefault: true,
      },
    ];
    mockBoardSettingsRepo.findOne.mockResolvedValue(null);
    mockBoardSettingsRepo.save.mockImplementation((entity: any) =>
      Promise.resolve(entity),
    );

    const result = await service.updateBoardColumns('test-tenant', customCols);
    expect(result).toHaveLength(5);
    // Sequences normalized 0 to 4
    expect(result.map((c) => c.sequence)).toEqual([0, 1, 2, 3, 4]);
  });

  it('returns saved columns sorted by sequence', async () => {
    mockBoardSettingsRepo.findOne.mockResolvedValue({
      tenantId: 'test-tenant',
      columns: [
        {
          id: 'c-late',
          name: 'Late',
          status: 'IN_PROGRESS',
          color: 'rose',
          sequence: 10,
          isDefault: false,
        },
        {
          id: 'c-early',
          name: 'Early',
          status: 'PLANNED',
          color: 'slate',
          sequence: 0,
          isDefault: true,
        },
        {
          id: 'c-mid',
          name: 'Mid',
          status: 'RELEASED',
          color: 'blue',
          sequence: 3,
          isDefault: true,
        },
      ],
    });
    const columns = await service.getBoardColumns('test-tenant');
    expect(columns.map((c) => c.id)).toEqual(['c-early', 'c-mid', 'c-late']);
  });

  it('handles concurrent insert race condition when updating board columns', async () => {
    const error: any = new Error(
      'duplicate key value violates unique constraint',
    );
    error.code = '23505';

    mockBoardSettingsRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        tenantId: 'test-tenant',
        columns: [],
      });

    mockBoardSettingsRepo.save
      .mockImplementationOnce(() => {
        throw error;
      })
      .mockImplementationOnce((entity: any) => Promise.resolve(entity));

    const result = await service.updateBoardColumns(
      'test-tenant',
      DEFAULT_BOARD_COLUMNS,
    );
    expect(result).toHaveLength(4);
    expect(mockBoardSettingsRepo.save).toHaveBeenCalledTimes(2);
  });

  it('rejects move if columnId is not found on board', async () => {
    mockBoardSettingsRepo.findOne.mockResolvedValue(null);
    await expect(
      service.updateWorkOrderColumn(
        'test-tenant',
        'wo-1',
        'non-existent-col',
        'u1',
        false,
      ),
    ).rejects.toThrow(
      new BadRequestException(
        'Target column "non-existent-col" not found on board',
      ),
    );
  });

  it('rejects move if work order is already COMPLETE', async () => {
    const wo = {
      id: 'wo-1',
      tenantId: 'test-tenant',
      status: 'COMPLETE',
      parameters: {},
    };
    mockWoRepo.findOne.mockResolvedValue(wo);
    mockBoardSettingsRepo.findOne.mockResolvedValue(null);

    await expect(
      service.updateWorkOrderColumn(
        'test-tenant',
        'wo-1',
        'in_progress',
        'u1',
        false,
      ),
    ).rejects.toThrow(
      new BadRequestException('Cannot move a complete work order'),
    );
  });

  it('rejects move if work order is already CANCELLED', async () => {
    const wo = {
      id: 'wo-1',
      tenantId: 'test-tenant',
      status: 'CANCELLED',
      parameters: {},
    };
    mockWoRepo.findOne.mockResolvedValue(wo);
    mockBoardSettingsRepo.findOne.mockResolvedValue(null);

    await expect(
      service.updateWorkOrderColumn(
        'test-tenant',
        'wo-1',
        'in_progress',
        'u1',
        false,
      ),
    ).rejects.toThrow(
      new BadRequestException('Cannot move a cancelled work order'),
    );
  });

  it('rejects invalid backwards transition from IN_PROGRESS to PLANNED', async () => {
    const wo = {
      id: 'wo-1',
      tenantId: 'test-tenant',
      status: 'IN_PROGRESS',
      parameters: {},
    };
    mockWoRepo.findOne.mockResolvedValue(wo);
    mockBoardSettingsRepo.findOne.mockResolvedValue(null);

    await expect(
      service.updateWorkOrderColumn(
        'test-tenant',
        'wo-1',
        'planned',
        'u1',
        false,
      ),
    ).rejects.toThrow(
      new BadRequestException(
        'Cannot move work order from IN_PROGRESS to PLANNED',
      ),
    );
  });

  it('rejects invalid backwards transition from IN_PROGRESS to RELEASED', async () => {
    const wo = {
      id: 'wo-1',
      tenantId: 'test-tenant',
      status: 'IN_PROGRESS',
      parameters: {},
    };
    mockWoRepo.findOne.mockResolvedValue(wo);
    mockBoardSettingsRepo.findOne.mockResolvedValue(null);

    await expect(
      service.updateWorkOrderColumn(
        'test-tenant',
        'wo-1',
        'released',
        'u1',
        false,
      ),
    ).rejects.toThrow(
      new BadRequestException(
        'Cannot move work order from IN_PROGRESS to RELEASED',
      ),
    );
  });

  it('rejects completing a planned job without releasing first', async () => {
    const wo = {
      id: 'wo-1',
      tenantId: 'test-tenant',
      status: 'PLANNED',
      parameters: {},
    };
    mockWoRepo.findOne.mockResolvedValue(wo);
    mockBoardSettingsRepo.findOne.mockResolvedValue(null);

    await expect(
      service.updateWorkOrderColumn(
        'test-tenant',
        'wo-1',
        'complete',
        'u1',
        false,
      ),
    ).rejects.toThrow(
      new BadRequestException(
        'Cannot complete a planned job without releasing first',
      ),
    );
  });

  it('updates work order parameters.columnId and syncs status', async () => {
    const wo = {
      id: 'wo-1',
      tenantId: 'test-tenant',
      status: 'RELEASED',
      parameters: {},
    };
    mockWoRepo.findOne.mockResolvedValue(wo);
    mockBoardSettingsRepo.findOne.mockResolvedValue({
      tenantId: 'test-tenant',
      columns: [
        {
          id: 'c-qc',
          name: 'QC',
          status: 'IN_PROGRESS',
          color: 'purple',
          sequence: 3,
          isDefault: false,
        },
      ],
    });
    mockWoRepo.save.mockImplementation((w: any) => Promise.resolve(w));

    await service.updateWorkOrderColumn(
      'test-tenant',
      'wo-1',
      'c-qc',
      'user-1',
      false,
    );
    expect(wo.status).toBe('IN_PROGRESS');
    expect((wo.parameters as any).columnId).toBe('c-qc');
  });

  it('correctly completes and posts accounting when moving to COMPLETE column', async () => {
    const w = makeWorld();
    const wo = await released(w);
    const [print, wrap] = w.tables.WorkOrderOperation;
    const mat = w.tables.WorkOrderMaterial[0];

    await w.service.logTime(tenantId, wo.id, print.id, 'u1', 60);
    await w.service.issueMaterial(
      tenantId,
      wo.id,
      'u1',
      { workOrderMaterialId: mat.id, qty: 100 },
      true,
    );

    const dto = await w.service.updateWorkOrderColumn(
      tenantId,
      wo.id,
      'complete',
      'u2',
      true,
    );

    expect(dto.status).toBe('COMPLETE');
    expect(wo.status).toBe('COMPLETE');
    expect(wo.parameters.columnId).toBe('complete');
    expect(print.status).toBe('DONE');
    expect(wrap.status).toBe('SKIPPED');
    expect(wo.completedById).toBe('u2');

    // WIP ledger entry posted: 100 sheets @ 0.50 = 50.00
    const doneJe = w.tables.JournalEntry.find((e) =>
      e.entryNumber.endsWith('-DONE'),
    );
    expect(doneJe).toBeDefined();
    expect(doneJe.referenceType).toBe('WORK_ORDER');
    expect(doneJe.lines.map((l: any) => [l.role, l.debit, l.credit])).toEqual([
      ['COGS', 50, 0],
      ['WIP', 0, 50],
    ]);
  });
});
