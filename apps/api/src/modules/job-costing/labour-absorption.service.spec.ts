import { LEDGER_ROLES } from '@saas/shared';
import { JobCostService } from './job-cost.service';
import {
  LABOUR_NOT_ABSORBED_FLAG,
  LabourAbsorptionService,
} from './labour-absorption.service';

const tenantId = '11111111-1111-1111-1111-111111111111';

/**
 * In-memory repositories keyed by entity name; `where` matches on equality,
 * TypeORM `In(...)` and `Between(...)`. `locks` records every
 * `find({ lock })` as `<entity>:<ids>`.
 */
function makeWorld() {
  const tables: Record<string, any[]> = {
    Employee: [],
    SalaryPackage: [],
    PayrollSettings: [],
    PensionScheme: [],
    WorkOrder: [],
    WorkOrderOperation: [],
    WorkOrderMaterial: [],
    WorkOrderLabour: [],
    TimesheetEntry: [],
    JournalEntry: [],
    PayrollRunLine: [],
    Organization: [{ id: tenantId, baseCurrency: 'AED' }],
  };
  const locks: string[] = [];
  let n = 0;

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
    create: (d: any) => ({ ...d }),
    findOne: async ({ where }: any) => {
      const r = tables[name].find((x) => matches(x, where));
      return r ? { ...r } : null;
    },
    find: async ({ where, lock, order }: any = {}) => {
      const rows = tables[name]
        .filter((r) => matches(r, where))
        .map((r) => ({ ...r }));
      if (order?.id === 'ASC') rows.sort((a, b) => a.id.localeCompare(b.id));
      if (lock) locks.push(`${name}:${rows.map((r) => r.id).join(',')}`);
      return rows;
    },
    update: async (where: any, patch: any) => {
      tables[name]
        .filter((r) => matches(r, where))
        .forEach((r) => Object.assign(r, patch));
    },
    delete: async (where: any) => {
      tables[name] = tables[name].filter((r) => !matches(r, where));
    },
    save: async (e: any) => {
      const list = Array.isArray(e) ? e : [e];
      for (const x of list) {
        x.id ??= `${name}-${++n}`;
        tables[name].push(x);
      }
      return e;
    },
  });
  const manager: any = {
    getRepository: (entity: { name: string }) => repo(entity.name),
  };
  const ledger: any = {
    resolveLines: jest.fn(async (_t: string, input: any[]) => {
      const d = input.reduce((s, l) => s + l.debit - l.credit, 0);
      if (Math.abs(d) > 0.005) throw new Error(`unbalanced by ${d}`);
      return input.map((l) => ({ ...l, ledgerAccountId: `acct-${l.role}` }));
    }),
  };
  const service = new LabourAbsorptionService(ledger, new JobCostService());

  tables.Employee.push({
    id: 'e1',
    tenantId,
    firstName: 'Ravi',
    lastName: 'Kumar',
    isNational: false,
    pensionSchemeId: null,
    annualLeaveDaysOverride: null,
  });
  tables.SalaryPackage.push({
    id: 'pkg1',
    tenantId,
    employeeId: 'e1',
    effectiveFrom: '2026-01-01',
    basic: 6000,
    housing: 2000,
    transport: 1000,
    otherAllowances: [],
  });
  const wo = (id: string, woNumber: string, status: string) => {
    tables.WorkOrder.push({
      id,
      tenantId,
      woNumber,
      status,
      qty: 1,
      qtyCompleted: status === 'COMPLETE' ? 1 : null,
      overheadPct: 0,
      estimatedCost: { tooling: 0 },
      actualCost: null,
      labourStatus: null,
      labourSplit: null,
    });
    tables.WorkOrderOperation.push({
      id: `op-${id}`,
      tenantId,
      workOrderId: id,
      workCenterId: 'wc',
      workCenterName: 'Press',
      status: status === 'COMPLETE' ? 'DONE' : 'IN_PROGRESS',
      estimatedSetupMinutes: 0,
      estimatedRunMinutes: 60,
      estimatedChargedMinutes: 60,
      actualMinutes: 0,
      machineCostPerHour: 0,
      laborCostPerHour: 0,
    });
  };
  wo('wo-open', 'WO-1', 'IN_PROGRESS');
  wo('wo-done', 'WO-2', 'COMPLETE');
  wo('wo-cancel', 'WO-3', 'CANCELLED');

  let t = 0;
  const entry = (hours: number, workOrderId: string | null, over: any = {}) => {
    const day = String((t % 28) + 1).padStart(2, '0');
    tables.TimesheetEntry.push({
      id: `t${++t}`,
      tenantId,
      employeeId: 'e1',
      workDate: `2026-10-${day}`,
      hours,
      workOrderId,
      operationId: workOrderId ? `op-${workOrderId}` : null,
      indirectCategory: workOrderId ? null : 'IDLE',
      runLineId: null,
      ...over,
    });
    return `t${t}`;
  };

  const run: any = {
    id: 'run1',
    tenantId,
    runNumber: 'PR-2026-10',
    period: '2026-10',
    labourJournalEntryId: null,
  };
  const line = (over: any = {}): any => {
    const l = {
      id: 'rl1',
      tenantId,
      runId: 'run1',
      employeeId: 'e1',
      daysEmployed: 31,
      daysInMonth: 31,
      overtimeHours: 0,
      overtimeHoursPremium: 0,
      salaryCost: 10400,
      pensionEmployer: 0,
      gratuityAccrual: 0,
      leaveProvisionChange: 0,
      flags: [],
      ...over,
    };
    tables.PayrollRunLine.push(l);
    return l;
  };

  /** prepare + post, as approval does, with the run's journal id recorded. */
  const approve = async (lines: any[]) => {
    const prepared = await service.prepare(manager, tenantId, run, lines);
    const id = await service.post(
      manager,
      tenantId,
      run,
      prepared,
      new Date('2026-10-31T00:00:00.000Z'),
    );
    run.labourJournalEntryId = id;
    return { prepared, id };
  };

  return { tables, manager, ledger, service, locks, entry, run, line, approve };
}

/** Σ debit and Σ credit per role on one entry. */
function byRole(entry: any) {
  const out: Record<string, { debit: number; credit: number }> = {};
  for (const l of entry.lines) {
    out[l.role] ??= { debit: 0, credit: 0 };
    out[l.role].debit = Math.round((out[l.role].debit + l.debit) * 100) / 100;
    out[l.role].credit =
      Math.round((out[l.role].credit + l.credit) * 100) / 100;
  }
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

describe('LabourAbsorptionService', () => {
  /** 40 h on an open job, 20 h on a completed one, 8 h idle; cost 10,400 over 208 h. */
  function standard() {
    const w = makeWorld();
    for (let i = 0; i < 5; i++) w.entry(8, 'wo-open');
    w.entry(12, 'wo-done');
    w.entry(8, 'wo-done');
    const idle = w.entry(8, null);
    const l = w.line();
    return { w, l, idle };
  }

  it('charges direct hours at cost ÷ standard: Dr WIP 2,000, Dr COGS 1,000, Cr 6390 3,000', async () => {
    const { w, l, idle } = standard();
    const { prepared, id } = await w.approve([l]);

    expect(l).toMatchObject({
      standardHours: 208,
      loggedHours: 68,
      directHours: 60,
      labourRate: 50,
      labourAbsorbed: 3000,
      flags: [],
    });
    expect(prepared.total).toBe(3000);

    expect(w.tables.JournalEntry).toHaveLength(1);
    const je = w.tables.JournalEntry[0];
    expect(je).toMatchObject({
      id,
      entryNumber: 'JE-PR-2026-10-LAB',
      referenceType: 'PAYROLL',
      referenceId: 'run1',
      totalAmount: 3000,
      currency: 'AED',
      entryDate: new Date('2026-10-31T00:00:00.000Z'),
    });
    expect(byRole(je)).toEqual({
      [LEDGER_ROLES.WIP]: { debit: 2000, credit: 0 },
      [LEDGER_ROLES.COGS]: { debit: 1000, credit: 0 },
      [LEDGER_ROLES.LABOUR_ABSORBED]: { debit: 0, credit: 3000 },
    });
    expect(je.lines.map((x: any) => x.description)).toEqual([
      'WO-2 labour October 2026',
      'WO-1 labour October 2026',
      'Payroll PR-2026-10 labour charged to jobs',
    ]);

    const rows = w.tables.WorkOrderLabour.map((r) => [
      r.workOrderId,
      r.account,
      r.hours,
      r.rate,
      r.amount,
      r.runLineId,
      r.journalEntryId,
      r.clearedTo,
    ]);
    expect(rows).toEqual(
      expect.arrayContaining([
        ['wo-open', 'WIP', 40, 50, 2000, 'rl1', id, null],
        ['wo-done', 'COGS', 20, 50, 1000, 'rl1', id, null],
      ]),
    );
    expect(rows).toHaveLength(2);

    // Every entry stamped, the idle one included.
    expect(w.tables.TimesheetEntry.every((e) => e.runLineId === 'rl1')).toBe(
      true,
    );
    expect(w.tables.TimesheetEntry.find((e) => e.id === idle)!.runLineId).toBe(
      'rl1',
    );
  });

  it('locks the touched work order rows in id order', async () => {
    const { w, l } = standard();
    await w.approve([l]);
    expect(w.locks).toEqual(['WorkOrder:wo-done,wo-open']);
  });

  it('absorbed never exceeds cost: 260 logged hours, all direct → absorbed = cost', async () => {
    const w = makeWorld();
    // 10,000.01 / 260 = 38.4616… → rate 38.4616; 260 × rate = 10,000.02 > cost.
    for (let i = 0; i < 13; i++) w.entry(20, i % 2 ? 'wo-open' : 'wo-done');
    const l = w.line({ salaryCost: 10000.01 });
    const { prepared } = await w.approve([l]);
    expect(l.loggedHours).toBe(260);
    expect(l.labourRate).toBe(38.4616);
    expect(l.labourAbsorbed).toBeLessThanOrEqual(10000.01);
    expect(l.labourAbsorbed).toBeGreaterThanOrEqual(10000.01 - 0.01);
    expect(prepared.total).toBe(l.labourAbsorbed);
    const sum = r2(w.tables.WorkOrderLabour.reduce((s, r) => s + r.amount, 0));
    expect(sum).toBe(l.labourAbsorbed);
  });

  it('hours on a cancelled job are not absorbed, stay unstamped, and flag the line', async () => {
    const w = makeWorld();
    w.entry(8, 'wo-open');
    const cancelled = w.entry(4, 'wo-cancel');
    const l = w.line();
    await w.approve([l]);
    expect(l.directHours).toBe(12);
    expect(l.labourAbsorbed).toBe(400);
    expect(l.flags).toEqual([LABOUR_NOT_ABSORBED_FLAG]);
    expect(
      w.tables.WorkOrderLabour.some((r) => r.workOrderId === 'wo-cancel'),
    ).toBe(false);
    expect(
      w.tables.TimesheetEntry.find((e) => e.id === cancelled)!.runLineId,
    ).toBeNull();
    // Locked too (its status is read under the lock), in id order.
    expect(w.locks).toEqual(['WorkOrder:wo-cancel,wo-open']);
  });

  it('a line with cost ≤ 0 absorbs nothing, posts nothing, flags the line, and still stamps', async () => {
    const w = makeWorld();
    w.entry(8, 'wo-open');
    const l = w.line({ salaryCost: 0 });
    const { prepared, id } = await w.approve([l]);
    expect(l.labourRate).toBe(0);
    expect(l.labourAbsorbed).toBe(0);
    expect(l.flags).toEqual([LABOUR_NOT_ABSORBED_FLAG]);
    expect(prepared.total).toBe(0);
    expect(id).toBeNull();
    expect(w.tables.JournalEntry).toHaveLength(0);
    expect(w.tables.WorkOrderLabour).toHaveLength(0);
    expect(w.tables.TimesheetEntry[0].runLineId).toBe('rl1');
  });

  it('only indirect hours: nothing absorbed and no flag', async () => {
    const w = makeWorld();
    w.entry(8, null);
    const l = w.line();
    const { id } = await w.approve([l]);
    expect(id).toBeNull();
    expect(l.flags).toEqual([]);
    expect(l.loggedHours).toBe(8);
    expect(l.directHours).toBe(0);
  });

  it('entries outside the period or of another employee are left alone', async () => {
    const w = makeWorld();
    w.entry(8, 'wo-open', { workDate: '2026-09-30' });
    w.entry(8, 'wo-open', { employeeId: 'e2' });
    const l = w.line();
    await w.approve([l]);
    expect(l.loggedHours).toBe(0);
    expect(w.tables.TimesheetEntry.every((e) => e.runLineId === null)).toBe(
      true,
    );
  });

  it('a completed job touched by the approval is recomputed: labour ACTUAL', async () => {
    const { w, l } = standard();
    await w.approve([l]);
    const done = w.tables.WorkOrder.find((x) => x.id === 'wo-done')!;
    expect(done.labourStatus).toBe('ACTUAL');
    expect(done.labourSplit).toEqual({
      actual: 1000,
      provisional: 0,
      unlinked: 0,
    });
    // Open jobs are not costed until they complete.
    expect(
      w.tables.WorkOrder.find((x) => x.id === 'wo-open')!.labourStatus,
    ).toBeNull();
  });

  it('a completed job is recomputed even when nothing was absorbed (J7)', async () => {
    const w = makeWorld();
    w.entry(8, 'wo-done');
    const l = w.line({ salaryCost: 0 });
    const { prepared } = await w.approve([l]);
    expect(prepared.completedWorkOrderIds).toEqual(['wo-done']);
    const done = w.tables.WorkOrder.find((x) => x.id === 'wo-done')!;
    expect(done.labourSplit).toEqual({
      actual: 0,
      provisional: 0,
      unlinked: 0,
    });
  });

  describe('wipLabour and clear', () => {
    it('wipLabour sums only a job’s WIP rows not yet cleared', async () => {
      const { w, l } = standard();
      w.entry(4, 'wo-open');
      await w.approve([l]);
      const open = w.tables.WorkOrderLabour.find(
        (r) => r.workOrderId === 'wo-open',
      )!;
      w.tables.WorkOrderLabour.push(
        { ...open, id: 'cleared', amount: 70, clearedTo: 'COGS' },
        { ...open, id: 'other-tenant', amount: 5, tenantId: 'someone-else' },
      );
      const got = await w.service.wipLabour(w.manager, tenantId, 'wo-open');
      expect(got).toEqual({ ids: [open.id], amount: open.amount });
      // COGS-booked rows are not WIP.
      expect(await w.service.wipLabour(w.manager, tenantId, 'wo-done')).toEqual(
        { ids: [], amount: 0 },
      );
    });

    it('clear stamps clearedTo and clearedAt on the given rows only', async () => {
      const { w, l } = standard();
      await w.approve([l]);
      const [a, b] = w.tables.WorkOrderLabour;
      await w.service.clear(w.manager, tenantId, [a.id], 'EXPENSE');
      expect(a.clearedTo).toBe('EXPENSE');
      expect(a.clearedAt).toBeInstanceOf(Date);
      expect(b.clearedTo).toBeNull();
      await w.service.clear(w.manager, tenantId, [], 'COGS');
      expect(b.clearedTo).toBeNull();
    });
  });

  describe('reverse', () => {
    it('void before completion credits WIP and COGS as booked', async () => {
      const { w, l } = standard();
      await w.approve([l]);
      const id = await w.service.reverse(w.manager, tenantId, w.run);
      const je = w.tables.JournalEntry.find((e) => e.id === id)!;
      expect(je.entryNumber).toBe('JE-PR-2026-10-LAB-VOID');
      expect(byRole(je)).toEqual({
        [LEDGER_ROLES.LABOUR_ABSORBED]: { debit: 3000, credit: 0 },
        [LEDGER_ROLES.WIP]: { debit: 0, credit: 2000 },
        [LEDGER_ROLES.COGS]: { debit: 0, credit: 1000 },
      });
    });

    it('void after completion reverses from COGS; rows deleted, entries unstamped, job back to PROVISIONAL', async () => {
      const { w, l } = standard();
      await w.approve([l]);
      // Task 9: completing the open job moves its WIP labour to COGS.
      const open = w.tables.WorkOrder.find((x) => x.id === 'wo-open')!;
      open.status = 'COMPLETE';
      open.qtyCompleted = 1;
      const row = w.tables.WorkOrderLabour.find(
        (r) => r.workOrderId === 'wo-open',
      )!;
      row.clearedTo = 'COGS';
      row.clearedAt = new Date('2026-11-02T00:00:00Z');

      const id = await w.service.reverse(w.manager, tenantId, w.run);
      const je = w.tables.JournalEntry.find((e) => e.id === id)!;
      expect(byRole(je)).toEqual({
        [LEDGER_ROLES.LABOUR_ABSORBED]: { debit: 3000, credit: 0 },
        [LEDGER_ROLES.COGS]: { debit: 0, credit: 3000 },
      });
      // Never dated before the journal it reverses.
      expect(je.entryDate.getTime()).toBeGreaterThanOrEqual(
        new Date('2026-10-31T00:00:00.000Z').getTime(),
      );

      expect(w.tables.WorkOrderLabour).toHaveLength(0);
      expect(w.tables.TimesheetEntry.every((e) => e.runLineId === null)).toBe(
        true,
      );
      for (const woId of ['wo-open', 'wo-done']) {
        const wo = w.tables.WorkOrder.find((x) => x.id === woId)!;
        expect(wo.labourStatus).toBe('PROVISIONAL');
        expect(wo.labourSplit.actual).toBe(0);
        expect(wo.labourSplit.provisional).toBeGreaterThan(0);
      }
    });

    it('rows a cancel returned to 6390 are skipped: 6390 and WIP net to zero', async () => {
      const { w, l } = standard();
      await w.approve([l]);
      const row = w.tables.WorkOrderLabour.find(
        (r) => r.workOrderId === 'wo-open',
      )!;
      row.clearedTo = 'EXPENSE';

      const id = await w.service.reverse(w.manager, tenantId, w.run);
      const je = w.tables.JournalEntry.find((e) => e.id === id)!;
      expect(byRole(je)).toEqual({
        [LEDGER_ROLES.LABOUR_ABSORBED]: { debit: 1000, credit: 0 },
        [LEDGER_ROLES.COGS]: { debit: 0, credit: 1000 },
      });
      // Approval Cr 3000, cancel Dr 2000, void Dr 1000 → 6390 at 0;
      // WIP: Dr 2000, cancel Cr 2000, void nothing → 0.
      expect(w.tables.WorkOrderLabour).toHaveLength(0);
    });

    it('nothing absorbed: no labour journal, entries still unstamped', async () => {
      const w = makeWorld();
      w.entry(8, null);
      const l = w.line();
      await w.approve([l]);
      expect(w.tables.TimesheetEntry[0].runLineId).toBe('rl1');
      const id = await w.service.reverse(w.manager, tenantId, w.run);
      expect(id).toBeNull();
      expect(w.tables.JournalEntry).toHaveLength(0);
      expect(w.tables.TimesheetEntry[0].runLineId).toBeNull();
    });
  });
});
