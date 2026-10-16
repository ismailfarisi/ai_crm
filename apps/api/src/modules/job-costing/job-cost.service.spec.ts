import { JobCostService } from './job-cost.service';

const tenantId = '11111111-1111-1111-1111-111111111111';

/**
 * In-memory stand-in for the repositories the service reads. Rows live per
 * entity name; `where` objects match on equality or a TypeORM `In(...)`.
 * `updates` records every targeted update.
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
  };
  const updates: { entity: string; where: any; patch: any }[] = [];

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
      tables[name].filter((r) => matches(r, where)).map((r) => ({ ...r })),
    update: async (where: any, patch: any) => {
      updates.push({ entity: name, where, patch });
      tables[name]
        .filter((r) => matches(r, where))
        .forEach((r) => Object.assign(r, patch));
    },
    save: async () => {
      throw new Error(`${name}.save: job costing writes owned columns only`);
    },
  });
  const manager: any = {
    getRepository: (entity: { name: string }) => repo(entity.name),
  };

  // An expat on 9000 gross (basic 6000) and a national on the same package.
  tables.Employee.push(
    {
      id: 'e-expat',
      tenantId,
      firstName: 'Ravi',
      lastName: 'Kumar',
      isNational: false,
      pensionSchemeId: null,
      annualLeaveDaysOverride: null,
    },
    {
      id: 'e-national',
      tenantId,
      firstName: 'Omar',
      lastName: 'Saeed',
      isNational: true,
      pensionSchemeId: 'ps-active',
      annualLeaveDaysOverride: null,
    },
  );
  const pkg = (employeeId: string, effectiveFrom: string, basic = 6000) => ({
    id: `pkg-${employeeId}-${effectiveFrom}`,
    tenantId,
    employeeId,
    effectiveFrom,
    basic,
    housing: 2000,
    transport: 1000,
    otherAllowances: [],
  });
  tables.SalaryPackage.push(
    pkg('e-expat', '2026-01-01'),
    // Starts after October: not in effect on its last day.
    pkg('e-expat', '2026-11-01', 12000),
    pkg('e-national', '2026-01-01'),
  );
  tables.PensionScheme.push(
    {
      id: 'ps-active',
      tenantId,
      employeePct: 11,
      employerPct: 15,
      base: 'GROSS',
      minSalary: 3000,
      maxSalary: 70000,
      isActive: true,
    },
    {
      id: 'ps-inactive',
      tenantId,
      employeePct: 11,
      employerPct: 15,
      base: 'GROSS',
      minSalary: 3000,
      maxSalary: 70000,
      isActive: false,
    },
  );

  const service = new JobCostService();
  return { service, tables, manager, updates };
}

/**
 * A job with one operation of 90 minutes at 20/h labour and 40/h machine:
 * the national's posted half hour (absorbed at 40/h), the expat's unposted
 * half hour, and half an hour nobody's timesheet accounts for.
 */
function seedJob(w: ReturnType<typeof makeWorld>, status = 'COMPLETE') {
  w.tables.WorkOrder.push({
    id: 'wo1',
    tenantId,
    status,
    qty: 10,
    qtyCompleted: status === 'COMPLETE' ? 10 : null,
    overheadPct: 0.1,
    estimatedCost: { tooling: 0 },
    actualCost: null,
    labourStatus: null,
    labourSplit: null,
  });
  w.tables.WorkOrderOperation.push({
    id: 'op1',
    tenantId,
    workOrderId: 'wo1',
    sequence: 10,
    workCenterId: 'press',
    workCenterName: 'Press',
    status: 'DONE',
    estimatedSetupMinutes: 0,
    estimatedRunMinutes: 60,
    estimatedChargedMinutes: 60,
    actualMinutes: 90,
    machineCostPerHour: 40,
    laborCostPerHour: 20,
  });
  w.tables.WorkOrderMaterial.push({
    id: 'm1',
    tenantId,
    workOrderId: 'wo1',
    valueIssued: 100,
  });
  w.tables.WorkOrderLabour.push({
    id: 'wol1',
    tenantId,
    workOrderId: 'wo1',
    employeeId: 'e-national',
    period: '2026-09',
    hours: 0.5,
    rate: 40,
    amount: 20,
  });
  w.tables.TimesheetEntry.push(
    {
      id: 't1',
      tenantId,
      employeeId: 'e-national',
      workDate: '2026-09-30',
      hours: 0.5,
      workOrderId: 'wo1',
      operationId: 'op1',
      runLineId: 'rl1',
    },
    {
      id: 't2',
      tenantId,
      employeeId: 'e-expat',
      workDate: '2026-10-02',
      hours: 0.5,
      workOrderId: 'wo1',
      operationId: 'op1',
      runLineId: null,
    },
  );
}

describe('JobCostService.estimatedRate', () => {
  it('an expat: gross plus gratuity and leave over standard hours', async () => {
    const w = makeWorld();
    // 9000 + 6000×21/30/12 (350) + 6000×30/30/12 (500) = 9850 / 208
    await expect(
      w.service.estimatedRate(w.manager, tenantId, 'e-expat', '2026-10'),
    ).resolves.toBe(47.3558);
  });

  it('a national on an active scheme: pension, no gratuity', async () => {
    const w = makeWorld();
    // 9000 + 9000×15% (1350) + 0 + 500 = 10850 / 208
    await expect(
      w.service.estimatedRate(w.manager, tenantId, 'e-national', '2026-10'),
    ).resolves.toBe(52.1635);
  });

  it('a national whose scheme is inactive has no pension', async () => {
    const w = makeWorld();
    w.tables.Employee[1].pensionSchemeId = 'ps-inactive';
    // 9000 + 0 + 0 + 500 = 9500 / 208
    await expect(
      w.service.estimatedRate(w.manager, tenantId, 'e-national', '2026-10'),
    ).resolves.toBe(45.6731);
  });

  it('no package in effect on the period’s last day is 0', async () => {
    const w = makeWorld();
    await expect(
      w.service.estimatedRate(w.manager, tenantId, 'e-expat', '2025-12'),
    ).resolves.toBe(0);
  });

  it('follows the tenant’s settings and the employee’s leave override', async () => {
    const w = makeWorld();
    w.tables.PayrollSettings.push({
      tenantId,
      annualLeaveDays: 30,
      monthlyStandardHours: 200,
    });
    w.tables.Employee[0].annualLeaveDaysOverride = 24;
    // 9000 + 350 + 6000×24/30/12 (400) = 9750 / 200
    await expect(
      w.service.estimatedRate(w.manager, tenantId, 'e-expat', '2026-10'),
    ).resolves.toBe(48.75);
  });

  it('memoises per employee and period in the cache passed', async () => {
    const w = makeWorld();
    const cache = new Map<string, number>();
    await w.service.estimatedRate(
      w.manager,
      tenantId,
      'e-expat',
      '2026-10',
      cache,
    );
    w.tables.SalaryPackage.length = 0;
    await expect(
      w.service.estimatedRate(w.manager, tenantId, 'e-expat', '2026-10', cache),
    ).resolves.toBe(47.3558);
    expect(cache.get('e-expat:2026-10')).toBe(47.3558);
  });
});

describe('JobCostService.split', () => {
  it('posted rows are actual, unposted entries provisional, the rest unlinked', async () => {
    const w = makeWorld();
    seedJob(w);
    const got = await w.service.split(w.manager, tenantId, 'wo1');
    // 0.5 h × 47.3558 = 23.68; 90 min − 1 h of entries = 0.5 h × 20 = 10.
    expect(got.split).toEqual({ actual: 20, provisional: 23.68, unlinked: 10 });
    expect(got.unlinkedHours).toBe(0.5);
    expect(got.byEmployee).toEqual([
      {
        employeeId: 'e-national',
        employeeName: 'Omar Saeed',
        hours: 0.5,
        rate: 40,
        amount: 20,
        status: 'ACTUAL',
      },
      {
        employeeId: 'e-expat',
        employeeName: 'Ravi Kumar',
        hours: 0.5,
        rate: 47.3558,
        amount: 23.68,
        status: 'PROVISIONAL',
      },
    ]);
  });

  it('an employee with posted and unposted hours gets a row for each', async () => {
    const w = makeWorld();
    seedJob(w);
    w.tables.TimesheetEntry.push({
      id: 't3',
      tenantId,
      employeeId: 'e-national',
      workDate: '2026-10-05',
      hours: 0.5,
      workOrderId: 'wo1',
      operationId: 'op1',
      runLineId: null,
    });
    const got = await w.service.split(w.manager, tenantId, 'wo1');
    const omar = got.byEmployee.filter((r) => r.employeeId === 'e-national');
    expect(omar.map((r) => [r.status, r.hours, r.amount])).toEqual([
      ['ACTUAL', 0.5, 20],
      // 0.5 × 52.1635 = 26.08
      ['PROVISIONAL', 0.5, 26.08],
    ]);
    // 1.5 h of entries cover the 90 minutes: nothing unlinked.
    expect(got.split.unlinked).toBe(0);
    expect(got.unlinkedHours).toBe(0);
  });

  it('provisional hours are priced per month at that month’s rate', async () => {
    const w = makeWorld();
    seedJob(w);
    w.tables.WorkOrderOperation[0].actualMinutes = 0;
    w.tables.TimesheetEntry.push({
      id: 't4',
      tenantId,
      employeeId: 'e-expat',
      workDate: '2026-11-02',
      hours: 1,
      workOrderId: 'wo1',
      operationId: 'op1',
      runLineId: null,
    });
    const got = await w.service.split(w.manager, tenantId, 'wo1');
    const ravi = got.byEmployee.find((r) => r.employeeId === 'e-expat')!;
    // October 0.5 × 47.3558 = 23.68; November (basic 12000, gross 15000):
    // 15000 + 700 + 1000 = 16700 / 208 = 80.2885 → 80.29.
    expect(ravi.amount).toBe(103.97);
    expect(ravi.hours).toBe(1.5);
    expect(ravi.rate).toBe(80.2885);
  });

  it('skipped operations leave nothing unlinked', async () => {
    const w = makeWorld();
    seedJob(w);
    w.tables.WorkOrderOperation[0].status = 'SKIPPED';
    const got = await w.service.split(w.manager, tenantId, 'wo1');
    expect(got.split.unlinked).toBe(0);
  });
});

describe('JobCostService.recompute', () => {
  it('rewrites a completed job’s actual cost, status and split, and nothing else', async () => {
    const w = makeWorld();
    seedJob(w);
    await w.service.recompute(w.manager, tenantId, ['wo1']);

    expect(w.updates).toHaveLength(1);
    const { entity, where, patch } = w.updates[0];
    expect(entity).toBe('WorkOrder');
    expect(where).toEqual({ id: 'wo1', tenantId });
    expect(Object.keys(patch).sort()).toEqual([
      'actualCost',
      'labourSplit',
      'labourStatus',
    ]);
    // labour 20 + 23.68 + 10 = 53.68; machine 1.5 h × 40 = 60; material 100.
    // direct 213.68, overhead 10% = 21.37, total 235.05 over 10 units.
    expect(patch.actualCost).toEqual({
      material: 100,
      machine: 60,
      labor: 53.68,
      tooling: 0,
      overhead: 21.37,
      total: 235.05,
      unit: 23.5048,
    });
    expect(patch.labourStatus).toBe('PROVISIONAL');
    expect(patch.labourSplit).toEqual({
      actual: 20,
      provisional: 23.68,
      unlinked: 10,
    });
  });

  it('leaves an open work order alone', async () => {
    const w = makeWorld();
    seedJob(w, 'IN_PROGRESS');
    await w.service.recompute(w.manager, tenantId, ['wo1']);
    expect(w.updates).toHaveLength(0);
  });
});

describe('JobCostService.breakdown', () => {
  it('cost and pay: everything', async () => {
    const w = makeWorld();
    seedJob(w);
    const got = await w.service.breakdown(w.manager, tenantId, 'wo1', {
      cost: true,
      pay: true,
    });
    expect(got).toMatchObject({
      actual: 20,
      provisional: 23.68,
      unlinked: 10,
      total: 53.68,
      unlinkedHours: 0.5,
      status: 'PROVISIONAL',
    });
    expect(
      got.byEmployee.every((r) => r.amount != null && r.rate != null),
    ).toBe(true);
  });

  it('without cost: hours only, every amount null', async () => {
    const w = makeWorld();
    seedJob(w);
    const got = await w.service.breakdown(w.manager, tenantId, 'wo1', {
      cost: false,
      pay: true,
    });
    expect(got).toMatchObject({
      actual: null,
      provisional: null,
      unlinked: null,
      total: null,
      unlinkedHours: 0.5,
    });
    expect(got.byEmployee.map((r) => [r.hours, r.rate, r.amount])).toEqual([
      [0.5, null, null],
      [0.5, null, null],
    ]);
  });

  it('cost without pay: totals, but no per-employee rate or amount', async () => {
    const w = makeWorld();
    seedJob(w);
    const got = await w.service.breakdown(w.manager, tenantId, 'wo1', {
      cost: true,
      pay: false,
    });
    expect(got.total).toBe(53.68);
    expect(got.byEmployee.map((r) => [r.hours, r.rate, r.amount])).toEqual([
      [0.5, null, null],
      [0.5, null, null],
    ]);
  });
});
