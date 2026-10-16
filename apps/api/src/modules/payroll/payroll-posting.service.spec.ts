import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FinanceAccount } from '../finance/entities/finance-account.entity';
import {
  gratuityEntitlement,
  leaveAccrued,
  leaveServiceDays,
  LEDGER_ROLES,
  PERMISSIONS,
} from '@saas/shared';
import { Organization } from '../organizations/entities/organization.entity';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { Employee } from './entities/employee.entity';
import { SalaryPackage } from './entities/salary-package.entity';
import { EmployeeAdvance } from './entities/employee-advance.entity';
import { PayrollRun, PayrollRunLine } from './entities/payroll-run.entity';
import { GratuityLedgerEntry } from './entities/gratuity-ledger-entry.entity';
import { LeaveRecord } from './entities/leave-record.entity';
import { LeaveLedgerEntry } from './entities/leave-ledger-entry.entity';
import { PensionScheme } from './entities/pension-scheme.entity';
import { PayrollSettings } from './entities/payroll-settings.entity';
import { PensionRemittance } from './entities/pension-remittance.entity';
import { Settlement } from './entities/settlement.entity';
import { EmployeesService } from './employees.service';
import { PayrollCryptoService } from './payroll-crypto.service';
import { AdvancesService } from './advances.service';
import { GratuityService } from './gratuity.service';
import { PayrollSettingsService } from './payroll-settings.service';
import { LeaveService } from './leave.service';
import { PensionService } from './pension.service';
import { PayrollRunsService } from './payroll-runs.service';
import { PayrollPostingService } from './payroll-posting.service';
import { TimesheetEntry } from '../job-costing/entities/timesheet-entry.entity';
import { WorkOrderLabour } from '../job-costing/entities/work-order-labour.entity';
import {
  WorkOrder,
  WorkOrderMaterial,
  WorkOrderOperation,
} from '../production/entities/work-order.entity';
import { JobCostService } from '../job-costing/job-cost.service';
import { LabourAbsorptionService } from '../job-costing/labour-absorption.service';

const T = '11111111-1111-4111-8111-111111111111';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const APPROVER = { userId: ACTOR, permissions: [PERMISSIONS.PAYROLL_APPROVE] };
const ADVISORY = 'SELECT pg_advisory_xact_lock(hashtext($1))';

/** Lock and read order across repositories and advisory locks. */
let events: string[] = [];

function repo(rows: any[], name = '') {
  let n = 0;
  const locks: string[] = [];
  // Equality, TypeORM In(...) and Between(...).
  const match = (r: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]: [string, any]) =>
      v && typeof v === 'object' && v._type === 'in'
        ? v._value.includes(r[k])
        : v && typeof v === 'object' && v._type === 'between'
          ? r[k] >= v._value[0] && r[k] <= v._value[1]
          : r[k] === v,
    );
  return {
    rows,
    locks,
    create: (d: any) => ({ ...d }),
    find: jest.fn(async ({ where, lock, order }: any = {}) => {
      const out = rows.filter((r) => match(r, where));
      if (order?.id === 'ASC') out.sort((a, b) => a.id.localeCompare(b.id));
      if (lock) events.push(`lock:${name}`);
      else if (name) events.push(`read:${name}`);
      return out;
    }),
    findOne: jest.fn(
      async ({ where }: any = {}) => rows.find((r) => match(r, where)) ?? null,
    ),
    save: jest.fn(async (e: any) => {
      const list = Array.isArray(e) ? e : [e];
      const out = list.map((x: any) => {
        if (!x.id) x.id = `id-${Math.random().toString(36).slice(2)}-${++n}`;
        const i = rows.findIndex((r) => r.id === x.id);
        if (i === -1) {
          x.createdAt ??= new Date('2026-10-20T00:00:00Z');
          x.updatedAt ??= new Date('2026-10-20T00:00:00Z');
          rows.push(x);
          return x;
        }
        if (rows[i] !== x) Object.assign(rows[i], x);
        return rows[i];
      });
      return Array.isArray(e) ? out : out[0];
    }),
    update: jest.fn(async (where: any, patch: any) => {
      for (const r of rows.filter((x) => match(x, where)))
        Object.assign(r, patch);
      return { affected: 1 };
    }),
    delete: jest.fn(async (where: any) => {
      const keep = rows.filter((x) => !match(x, where));
      rows.length = 0;
      rows.push(...keep);
      return { affected: 1 };
    }),
    createQueryBuilder: jest.fn(() => {
      const params: any = {};
      const qb: any = {
        setLock: jest.fn((mode: string) => {
          locks.push(mode);
          events.push(`lock:${name || 'row'}`);
          return qb;
        }),
        where: jest.fn((_s: string, p: any) => (Object.assign(params, p), qb)),
        andWhere: jest.fn(
          (_s: string, p: any) => (Object.assign(params, p), qb),
        ),
        getOne: jest.fn(async () => {
          const r = rows.find(
            (x) => x.id === params.id && x.tenantId === params.tenantId,
          );
          return r ? { ...r } : null;
        }),
      };
      return qb;
    }),
    remove: jest.fn(async (e: any) => e),
  };
}

const emp = (id: string, num: string, over: any = {}) => ({
  id,
  tenantId: T,
  employeeNumber: num,
  firstName: 'Emp',
  lastName: num,
  jobTitle: 'Technician',
  department: 'Ops',
  joiningDate: '2023-11-01',
  leavingDate: null,
  status: 'ACTIVE',
  isNational: false,
  paymentMethod: 'BANK',
  bankName: 'ENBD',
  ibanEncrypted: 'cipher',
  ibanLast4: '1234',
  ...over,
});

const pkg = (
  id: string,
  employeeId: string,
  effectiveFrom: string,
  basic: number,
  housing = 0,
  transport = 0,
) => ({
  id,
  tenantId: T,
  employeeId,
  effectiveFrom,
  basic,
  housing,
  transport,
  otherAllowances: [],
});

function setup() {
  events = [];
  const employees = repo([
    emp('a', 'EMP-001'),
    emp('b', 'EMP-002', { joiningDate: '2026-10-16', paymentMethod: 'CASH' }),
  ]);
  const packages = repo([
    pkg('pa1', 'a', '2023-11-01', 6000, 2000, 500),
    pkg('pb', 'b', '2026-10-16', 3100),
  ]);
  const advances = repo([
    { id: 'adv1', tenantId: T, employeeId: 'a', amount: 3000 },
  ]);
  const runs = repo([], 'PayrollRun');
  const lines = repo([]);
  const gratuity = repo([]);
  const entries = repo([]);
  const orgs = repo([{ id: T, name: 'Acme', baseCurrency: 'AED' }]);
  const leaveRecords = repo([]);
  const leaveLedger = repo([]);
  const schemes = repo([]);
  const remittances = repo([]);
  const settlements = repo([]);
  const timesheets = repo([], 'TimesheetEntry');
  const workOrders = repo([], 'WorkOrder');
  const operations = repo([]);
  const labourRows = repo([]);
  const repos = new Map<any, any>([
    [Employee, employees],
    [SalaryPackage, packages],
    [EmployeeAdvance, advances],
    [PayrollRun, runs],
    [PayrollRunLine, lines],
    [GratuityLedgerEntry, gratuity],
    [LeaveRecord, leaveRecords],
    [LeaveLedgerEntry, leaveLedger],
    [PensionScheme, schemes],
    [PayrollSettings, repo([])],
    [PensionRemittance, remittances],
    [Settlement, settlements],
    [JournalEntry, entries],
    [Organization, orgs],
    [TimesheetEntry, timesheets],
    [WorkOrder, workOrders],
    [WorkOrderOperation, operations],
    [WorkOrderMaterial, repo([])],
    [WorkOrderLabour, labourRows],
  ]);
  let seq = 0;
  const calls: string[] = [];
  const manager: any = {
    getRepository: (e: any) => repos.get(e),
    query: jest.fn(async (sql: string, params?: any[]) => {
      calls.push(sql);
      if (sql === ADVISORY) events.push(`advisory:${String(params?.[0]).split(':')[0]}`);
      return [{ current_value: ++seq }];
    }),
  };
  const dataSource: any = { manager, transaction: (cb: any) => cb(manager) };
  const ledger: any = {
    resolveLines: jest.fn(async (_t: string, input: any[]) => {
      const d = input.reduce((s, l) => s + l.debit - l.credit, 0);
      if (Math.abs(d) > 0.005) throw new Error(`unbalanced by ${d}`);
      return input.map((l) => ({
        ...l,
        ledgerAccountId: l.ledgerAccountId ?? `acct-${l.role}`,
        ledgerAccountCode: 'x',
      }));
    }),
  };
  const employeesService = new EmployeesService(
    dataSource,
    new PayrollCryptoService({}),
  );
  const advancesService = new AdvancesService(dataSource, ledger);
  const gratuityService = new GratuityService(
    dataSource,
    ledger,
    employeesService,
  );
  const leaveService = new LeaveService(
    dataSource,
    gratuityService,
    new PayrollSettingsService(dataSource),
    ledger,
    employeesService,
  );
  const runsService = new PayrollRunsService(
    dataSource,
    employeesService,
    advancesService,
    gratuityService,
    leaveService,
    new PensionService(dataSource),
  );
  const service = new PayrollPostingService(
    dataSource,
    ledger,
    runsService,
    advancesService,
    gratuityService,
    leaveService,
    new LabourAbsorptionService(ledger, new JobCostService()),
  );
  return {
    service,
    runsService,
    gratuityService,
    leaveService,
    leaveRecords,
    leaveLedger,
    schemes,
    remittances,
    settlements,
    manager,
    calls,
    ledger,
    employees,
    packages,
    advances,
    runs,
    lines,
    gratuity,
    entries,
    timesheets,
    workOrders,
    operations,
    labourRows,
  };
}

type Ctx = ReturnType<typeof setup>;

const lineOf = (dto: any, num: string) =>
  dto.lines.find((l: any) => l.employeeNumber === num);

async function draft(ctx: Ctx, period: string) {
  return ctx.runsService.create(T, ACTOR, { period, payDate: null });
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

function balanced(entry: any) {
  const d = entry.lines.reduce((s: number, l: any) => s + l.debit, 0);
  const c = entry.lines.reduce((s: number, l: any) => s + l.credit, 0);
  return Math.abs(d - c) < 0.005;
}

const ent = (joiningDate: string, asOf: string, basic: number, unpaid = 0) =>
  gratuityEntitlement({
    joiningDate,
    asOf,
    basic,
    unpaidLeaveDays: unpaid,
    isNational: false,
  });

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Statutory leave days earned by `asOf` at the default 30 days a year. */
const accr = (joiningDate: string, asOf: string, unpaidDays = 0) =>
  leaveAccrued({
    serviceDays: leaveServiceDays({ joiningDate, asOf, unpaidDays }),
    annualDays: 30,
  });

const GPSSA = {
  id: 'gpssa',
  tenantId: T,
  name: 'GPSSA',
  presetKey: 'GPSSA_2023',
  employeePct: 11,
  employerPct: 15,
  base: 'GROSS',
  minSalary: 3000,
  maxSalary: 70000,
  isActive: true,
};

/** A national on 20000 basic + 10000 housing; on GPSSA unless told otherwise. */
function addNational(ctx: Ctx, schemeId: string | null = 'gpssa') {
  if (!ctx.schemes.rows.some((s) => s.id === 'gpssa')) {
    ctx.schemes.rows.push({ ...GPSSA });
  }
  ctx.employees.rows.push(
    emp('n', 'EMP-003', {
      isNational: true,
      joiningDate: '2020-01-01',
      pensionSchemeId: schemeId,
    }),
  );
  ctx.packages.rows.push(pkg('pn', 'n', '2020-01-01', 20000, 10000));
}

function annualLeave(
  ctx: Ctx,
  employeeId: string,
  startDate: string,
  endDate: string,
  days: number,
) {
  ctx.leaveRecords.rows.push({
    id: `lr-${ctx.leaveRecords.rows.length + 1}`,
    tenantId: T,
    employeeId,
    type: 'ANNUAL',
    startDate,
    endDate,
    days,
    note: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
  });
}

describe('PayrollPostingService', () => {
  describe('approve', () => {
    it('posts a balanced entry with exactly the role amounts for a two-employee run', async () => {
      const ctx = setup();
      const run = await draft(ctx, '2026-10');
      await ctx.runsService.updateLine(T, run.id, lineOf(run, 'EMP-001').id, {
        bonusAmount: 500,
        advanceRecovery: 1000,
        otherDeductionAmount: 200,
      } as any);

      const out = await ctx.service.approve(T, run.id, APPROVER);

      expect(out.status).toBe('APPROVED');
      expect(out.approvedById).toBe(ACTOR);
      expect(ctx.entries.rows).toHaveLength(1);
      const entry = ctx.entries.rows[0];
      expect(out.journalEntryId).toBe(entry.id);
      expect(entry.entryNumber).toBe(`JE-${run.runNumber}`);
      expect(entry.referenceType).toBe('PAYROLL');
      expect(entry.referenceId).toBe(run.id);
      expect(entry.entryDate).toEqual(new Date('2026-10-31T00:00:00.000Z'));
      expect(entry.currency).toBe('AED');
      expect(balanced(entry)).toBe(true);

      const ga = ent('2023-11-01', '2026-10-31', 6000).amount;
      const gb = ent('2026-10-16', '2026-10-31', 3100).amount;
      const G = Math.round((ga + gb) * 100) / 100;
      // b joined this month: under six months, no leave earned yet.
      const LP = r2((accr('2023-11-01', '2026-10-31') * 6000) / 30);
      // a: 8500 + 500 bonus = 9000 cost, net 7800; b: 1600 prorated.
      expect(byRole(entry)).toEqual({
        [LEDGER_ROLES.SALARIES]: { debit: 10600, credit: 200 },
        [LEDGER_ROLES.SALARIES_PAYABLE]: { debit: 0, credit: 9400 },
        [LEDGER_ROLES.EMPLOYEE_ADVANCES]: { debit: 0, credit: 1000 },
        [LEDGER_ROLES.GRATUITY_EXPENSE]: { debit: G, credit: 0 },
        [LEDGER_ROLES.GRATUITY_PROVISION]: { debit: 0, credit: G },
        [LEDGER_ROLES.LEAVE_EXPENSE]: { debit: LP, credit: 0 },
        [LEDGER_ROLES.LEAVE_PROVISION]: { debit: 0, credit: LP },
      });
      expect(entry.totalAmount).toBeCloseTo(10600 + G + LP, 2);
      expect(out.totals.gratuityAccrual).toBeCloseTo(G, 2);
      expect(out.totals.salaryCost).toBe(10600);
      expect(out.totals.net).toBe(9400);
    });

    it('first approval with no gratuity history accrues the full entitlement to month end', async () => {
      const ctx = setup();
      const run = await draft(ctx, '2026-10');
      const out = await ctx.service.approve(T, run.id, APPROVER);
      const a = lineOf(out, 'EMP-001');
      const want = ent('2023-11-01', '2026-10-31', 6000);
      expect(want.serviceDays).toBe(1096);
      expect(a.gratuityBefore).toBe(0);
      expect(a.gratuityAccrual).toBe(want.amount);
      expect(a.gratuityAfter).toBe(want.amount);
      const rows = ctx.gratuity.rows.filter((r) => r.employeeId === 'a');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: 'ACCRUAL',
        amount: want.amount,
        asOf: '2026-10-31',
        runLineId: a.id,
        journalEntryId: out.journalEntryId,
      });
    });

    it('trues up after a raise: Nov accrual = entitlement at Nov 30 on the new basic − balance after Oct', async () => {
      const ctx = setup();
      const oct = await draft(ctx, '2026-10');
      await ctx.service.approve(T, oct.id, APPROVER);
      const afterOct = ent('2023-11-01', '2026-10-31', 6000).amount;

      ctx.packages.rows.push(pkg('pa2', 'a', '2026-11-01', 7000, 2000, 500));
      const nov = await draft(ctx, '2026-11');
      const out = await ctx.service.approve(T, nov.id, APPROVER);
      const a = lineOf(out, 'EMP-001');
      const novEnt = ent('2023-11-01', '2026-11-30', 7000).amount;
      expect(a.gratuityBefore).toBe(afterOct);
      expect(a.gratuityAccrual).toBeCloseTo(novEnt - afterOct, 2);
      expect(a.gratuityAfter).toBe(novEnt);
      expect(await ctx.gratuityService.balance(ctx.manager, T, 'a')).toBe(
        novEnt,
      );
    });

    it('a gratuity adjustment survives the next approval: the true-up excludes it', async () => {
      const ctx = setup();
      const oct = await draft(ctx, '2026-10');
      await ctx.service.approve(T, oct.id, APPROVER);
      const afterOct = ent('2023-11-01', '2026-10-31', 6000).amount;
      await ctx.gratuityService.adjust(T, 'a', ACTOR, { amount: 1000, note: 'Contractual extra' });

      const nov = await draft(ctx, '2026-11');
      const out = await ctx.service.approve(T, nov.id, APPROVER);
      const a = lineOf(out, 'EMP-001');
      const novEnt = ent('2023-11-01', '2026-11-30', 6000).amount;
      expect(a.gratuityBefore).toBe(Math.round((afterOct + 1000) * 100) / 100);
      expect(a.gratuityAccrual).toBeCloseTo(novEnt - afterOct, 2);
      expect(a.gratuityAfter).toBeCloseTo(novEnt + 1000, 2);
      expect(await ctx.gratuityService.balance(ctx.manager, T, 'a')).toBeCloseTo(novEnt + 1000, 2);
    });

    it('an opening override above the calculated amount survives the first approval', async () => {
      const ctx = setup();
      const calc = ent('2023-11-01', '2026-09-30', 6000).amount;
      await ctx.gratuityService.postOpening(T, ACTOR, {
        cutoverDate: '2026-09-30',
        lines: [{ employeeId: 'a', amount: calc + 500 }],
      });
      const oct = await draft(ctx, '2026-10');
      const out = await ctx.service.approve(T, oct.id, APPROVER);
      const a = lineOf(out, 'EMP-001');
      const octEnt = ent('2023-11-01', '2026-10-31', 6000).amount;
      expect(a.gratuityBefore).toBeCloseTo(calc + 500, 2);
      expect(a.gratuityAccrual).toBeCloseTo(octEnt - calc, 2);
      expect(a.gratuityAfter).toBeCloseTo(octEnt + 500, 2);
    });

    it('a pay cut accrues negatively: Dr provision / Cr gratuity expense, still balanced', async () => {
      const ctx = setup();
      const oct = await draft(ctx, '2026-10');
      await ctx.service.approve(T, oct.id, APPROVER);
      ctx.packages.rows.push(pkg('pa2', 'a', '2026-11-01', 4000, 2000, 500));
      const nov = await draft(ctx, '2026-11');
      const out = await ctx.service.approve(T, nov.id, APPROVER);

      const G = out.totals.gratuityAccrual;
      expect(G).toBeLessThan(0);
      const entry = ctx.entries.rows.find((e) => e.id === out.journalEntryId);
      expect(balanced(entry)).toBe(true);
      const roles = byRole(entry);
      expect(roles[LEDGER_ROLES.GRATUITY_PROVISION]).toEqual({
        debit: Math.abs(G),
        credit: 0,
      });
      expect(roles[LEDGER_ROLES.GRATUITY_EXPENSE]).toEqual({
        debit: 0,
        credit: Math.abs(G),
      });
      const a = lineOf(out, 'EMP-001');
      expect(a.gratuityAccrual).toBeLessThan(0);
      const accrual = ctx.gratuity.rows.find((r) => r.runLineId === a.id);
      expect(accrual.amount).toBe(a.gratuityAccrual);
    });

    it("counts the current run's unpaid leave: 10 unpaid days → 10 fewer service days", async () => {
      const ctx = setup();
      const run = await draft(ctx, '2026-10');
      await ctx.runsService.updateLine(T, run.id, lineOf(run, 'EMP-001').id, {
        unpaidLeaveDays: 10,
      } as any);
      const spy = jest.spyOn(ctx.gratuityService, 'entitlement');
      const out = await ctx.service.approve(T, run.id, APPROVER);

      const i = spy.mock.calls.findIndex(([, , e]) => e.id === 'a');
      const got = await spy.mock.results[i].value;
      const without = ent('2023-11-01', '2026-10-31', 6000);
      expect(got.serviceDays).toBe(without.serviceDays - 10);
      expect(lineOf(out, 'EMP-001').gratuityAccrual).toBe(
        ent('2023-11-01', '2026-10-31', 6000, 10).amount,
      );
    });

    it('a national accrues 0 and gets no gratuity row', async () => {
      const ctx = setup();
      ctx.schemes.rows.push({ ...GPSSA });
      ctx.employees.rows.push(
        emp('g', 'EMP-007', { isNational: true, pensionSchemeId: 'gpssa' }),
      );
      ctx.packages.rows.push(pkg('pg', 'g', '2023-11-01', 9000));
      const run = await draft(ctx, '2026-10');
      const out = await ctx.service.approve(T, run.id, APPROVER);
      const g = lineOf(out, 'EMP-007');
      expect(g.gratuityAccrual).toBe(0);
      expect(ctx.gratuity.rows.some((r) => r.employeeId === 'g')).toBe(false);
    });

    it('refuses a run that is not DRAFT (409) and an actor without payroll:approve (403)', async () => {
      const ctx = setup();
      const run = await draft(ctx, '2026-10');
      await expect(
        ctx.service.approve(T, run.id, { userId: ACTOR, permissions: [] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await ctx.service.approve(T, run.id, APPROVER);
      await expect(
        ctx.service.approve(T, run.id, APPROVER),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(ctx.entries.rows).toHaveLength(1);
    });

    it('locks the run, then takes the gratuity-opening advisory lock, and writes the run by targeted update', async () => {
      const ctx = setup();
      const run = await draft(ctx, '2026-10');
      ctx.runs.save.mockClear();
      ctx.calls.length = 0;
      await ctx.service.approve(T, run.id, APPROVER);
      expect(ctx.runs.locks).toContain('pessimistic_write');
      expect(ctx.manager.query).toHaveBeenCalledWith(ADVISORY, [
        `gratuity-opening:${T}`,
      ]);
      expect(ctx.runs.save).not.toHaveBeenCalled();
      expect(ctx.runs.update).toHaveBeenCalledWith(
        { id: run.id, tenantId: T },
        expect.objectContaining({ status: 'APPROVED', approvedById: ACTOR }),
      );
    });

    it('refuses (409) when an opening balance was posted at or after the period end since the run was created', async () => {
      const ctx = setup();
      const run = await draft(ctx, '2026-10');
      ctx.gratuity.rows.push({
        id: 'open-a',
        tenantId: T,
        employeeId: 'a',
        kind: 'OPENING',
        amount: 100,
        asOf: '2026-10-31',
        runLineId: null,
        journalEntryId: null,
      });
      await expect(
        ctx.service.approve(T, run.id, APPROVER),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(ctx.entries.rows).toHaveLength(0);
      expect(ctx.runs.rows[0].status).toBe('DRAFT');
    });

    it('re-validates stale lines: refuses a negative net pay, naming the employee', async () => {
      const ctx = setup();
      const run = await draft(ctx, '2026-10');
      // A refresh that shrank the package saved the old extras as they were.
      const row = ctx.lines.rows.find((l) => l.employeeId === 'b');
      row.otherDeductionAmount = 5000;
      await expect(ctx.service.approve(T, run.id, APPROVER)).rejects.toThrow(
        /Emp EMP-002/,
      );
      await expect(
        ctx.service.approve(T, run.id, APPROVER),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(ctx.entries.rows).toHaveLength(0);
    });

    it('re-validates stale lines: refuses more unpaid leave than days employed', async () => {
      const ctx = setup();
      const run = await draft(ctx, '2026-10');
      const row = ctx.lines.rows.find((l) => l.employeeId === 'b');
      row.leaveOverridden = true; // typed by hand, so approval keeps it
      row.unpaidLeaveDays = 20; // employed 16 days
      await expect(ctx.service.approve(T, run.id, APPROVER)).rejects.toThrow(
        /Emp EMP-002/,
      );
      expect(ctx.entries.rows).toHaveLength(0);
    });

    it('refuses (409) a line whose employee has an approved or paid settlement', async () => {
      const ctx = setup();
      const run = await draft(ctx, '2026-10');
      ctx.settlements.rows.push({
        id: 's1',
        tenantId: T,
        settlementNumber: 'FS-0001',
        employeeId: 'b',
        employeeName: 'Emp EMP-002',
        leavingDate: '2026-09-30',
        status: 'APPROVED',
      });
      for (const status of ['APPROVED', 'PAID']) {
        ctx.settlements.rows[0].status = status;
        const err = await ctx.service
          .approve(T, run.id, APPROVER)
          .catch((e) => e);
        expect(err).toBeInstanceOf(ConflictException);
        expect(err.message).toBe('Emp EMP-002 is settled — refresh the run');
      }
      expect(ctx.entries.rows).toHaveLength(0);
      expect(ctx.gratuity.rows).toHaveLength(0);

      ctx.settlements.rows[0].status = 'VOIDED';
      const out = await ctx.service.approve(T, run.id, APPROVER);
      expect(out.status).toBe('APPROVED');
    });

    it('refuses (409) when an employee’s dates changed since the draft (a leaving date recorded, a rehire)', async () => {
      const ctx = setup();
      const run = await draft(ctx, '2026-10');
      const a = ctx.employees.rows.find((e) => e.id === 'a');
      Object.assign(a, { status: 'LEFT', leavingDate: '2026-10-10' });
      const err = await ctx.service.approve(T, run.id, APPROVER).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(
        "Emp EMP-001's employment dates changed — refresh the run",
      );
      expect(ctx.entries.rows).toHaveLength(0);

      // A leaver drafted for their final month, then set back to ACTIVE.
      const ctx2 = setup();
      const b = ctx2.employees.rows.find((e) => e.id === 'b');
      Object.assign(b, { status: 'LEFT', leavingDate: '2026-10-20' });
      const run2 = await draft(ctx2, '2026-10');
      Object.assign(b, { status: 'ACTIVE', leavingDate: null });
      await expect(
        ctx2.service.approve(T, run2.id, APPROVER),
      ).rejects.toThrow("Emp EMP-002's employment dates changed — refresh the run");

      // Refreshing picks up the new dates and approval goes through.
      await ctx2.runsService.refresh(T, run2.id);
      expect(
        ctx2.lines.rows.find((l) => l.employeeId === 'b').daysEmployed,
      ).toBe(16);
      const out = await ctx2.service.approve(T, run2.id, APPROVER);
      expect(out.status).toBe('APPROVED');
    });

    it('refuses advance recovery across two drafts that together exceed the outstanding advance', async () => {
      const ctx = setup();
      const oct = await draft(ctx, '2026-10');
      const nov = await draft(ctx, '2026-11');
      // Each alone is within the 3000 outstanding.
      await ctx.runsService.updateLine(T, oct.id, lineOf(oct, 'EMP-001').id, {
        advanceRecovery: 2000,
      } as any);
      await ctx.runsService.updateLine(T, nov.id, lineOf(nov, 'EMP-001').id, {
        advanceRecovery: 2000,
      } as any);
      await ctx.service.approve(T, oct.id, APPROVER);
      const err = await ctx.service
        .approve(T, nov.id, APPROVER)
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/Emp EMP-001/);
      expect(ctx.entries.rows).toHaveLength(1);
    });
  });

  describe('approve: pension and leave provision', () => {
    it('posts pension and the leave provision for a national on GPSSA and an expat with 2 annual days', async () => {
      const ctx = setup();
      ctx.employees.rows.splice(
        ctx.employees.rows.findIndex((e) => e.id === 'b'),
        1,
      );
      addNational(ctx);
      annualLeave(ctx, 'a', '2026-10-12', '2026-10-13', 2);
      const run = await draft(ctx, '2026-10');

      const out = await ctx.service.approve(T, run.id, APPROVER);

      const entry = ctx.entries.rows.find((e) => e.id === out.journalEntryId);
      expect(balanced(entry)).toBe(true);
      const n = lineOf(out, 'EMP-003');
      const a = lineOf(out, 'EMP-001');
      // GROSS basis 30000 within [3000, 70000]: 11% and 15%.
      expect(n).toMatchObject({
        pensionBase: 30000,
        pensionEmployee: 3300,
        pensionEmployer: 4500,
        netPay: 26700,
        gratuityAccrual: 0,
      });
      expect(a.annualLeaveDays).toBe(2);

      const daysA = accr('2023-11-01', '2026-10-31');
      const daysN = accr('2020-01-01', '2026-10-31');
      const lpA = r2(((daysA - 2) * 6000) / 30);
      const lpN = r2((daysN * 20000) / 30);
      const LP = r2(lpA + lpN);
      const G = ent('2023-11-01', '2026-10-31', 6000).amount;
      expect(byRole(entry)).toEqual({
        [LEDGER_ROLES.SALARIES]: { debit: 38500, credit: 0 },
        [LEDGER_ROLES.SALARIES_PAYABLE]: { debit: 0, credit: 35200 },
        [LEDGER_ROLES.PENSION_PAYABLE]: { debit: 0, credit: 7800 },
        [LEDGER_ROLES.PENSION_EXPENSE]: { debit: 4500, credit: 0 },
        [LEDGER_ROLES.GRATUITY_EXPENSE]: { debit: G, credit: 0 },
        [LEDGER_ROLES.GRATUITY_PROVISION]: { debit: 0, credit: G },
        [LEDGER_ROLES.LEAVE_EXPENSE]: { debit: LP, credit: 0 },
        [LEDGER_ROLES.LEAVE_PROVISION]: { debit: 0, credit: LP },
      });
      expect(entry.totalAmount).toBeCloseTo(38500 + G + 4500 + LP, 2);
      expect(out.totals).toMatchObject({
        pensionEmployee: 3300,
        pensionEmployer: 4500,
        leaveProvision: LP,
      });

      expect(a).toMatchObject({
        leaveProvisionBefore: 0,
        leaveProvisionChange: lpA,
        leaveProvisionAfter: lpA,
      });
      const rowsA = ctx.leaveLedger.rows.filter((r) => r.employeeId === 'a');
      expect(rowsA).toEqual([
        expect.objectContaining({
          kind: 'ACCRUAL',
          days: daysA,
          amount: lpA,
          asOf: '2026-10-31',
          runLineId: a.id,
          journalEntryId: entry.id,
        }),
        expect.objectContaining({
          kind: 'TAKEN',
          days: -2,
          amount: null,
          asOf: '2026-10-31',
          runLineId: a.id,
          journalEntryId: entry.id,
        }),
      ]);
      const rowsN = ctx.leaveLedger.rows.filter((r) => r.employeeId === 'n');
      expect(rowsN).toEqual([
        expect.objectContaining({ kind: 'ACCRUAL', days: daysN, amount: lpN }),
      ]);
      expect(await ctx.leaveService.provisionBalance(ctx.manager, T, 'a')).toBe(lpA);
    });

    it('first approval accrues the statutory days to month end; the next month only the difference; leave taken reduces balance and provision', async () => {
      const ctx = setup();
      const oct = await draft(ctx, '2026-10');
      const outOct = await ctx.service.approve(T, oct.id, APPROVER);
      const octDays = accr('2023-11-01', '2026-10-31');
      const octProv = r2((octDays * 6000) / 30);
      const aOct = lineOf(outOct, 'EMP-001');
      expect(aOct.leaveProvisionAfter).toBe(octProv);
      expect(
        ctx.leaveLedger.rows.find((r) => r.runLineId === aOct.id && r.kind === 'ACCRUAL')
          .days,
      ).toBe(octDays);
      // b is under six months: an ACCRUAL row of 0 days and 0 amount.
      const bOct = lineOf(outOct, 'EMP-002');
      expect(ctx.leaveLedger.rows.filter((r) => r.runLineId === bOct.id)).toEqual([
        expect.objectContaining({ kind: 'ACCRUAL', days: 0, amount: 0 }),
      ]);

      annualLeave(ctx, 'a', '2026-11-09', '2026-11-11', 3);
      const nov = await draft(ctx, '2026-11');
      const outNov = await ctx.service.approve(T, nov.id, APPROVER);
      const aNov = lineOf(outNov, 'EMP-001');
      const novDays = accr('2023-11-01', '2026-11-30');
      const balance = r2(novDays - 3);
      const novProv = r2((balance * 6000) / 30);
      const rows = ctx.leaveLedger.rows.filter((r) => r.runLineId === aNov.id);
      expect(rows.find((r) => r.kind === 'ACCRUAL').days).toBe(r2(novDays - octDays));
      expect(rows.find((r) => r.kind === 'TAKEN').days).toBe(-3);
      expect(aNov).toMatchObject({
        leaveProvisionBefore: octProv,
        leaveProvisionChange: r2(novProv - octProv),
        leaveProvisionAfter: novProv,
      });
      expect(await ctx.leaveService.balanceDays(ctx.manager, T, 'a')).toBe(balance);
      expect(await ctx.leaveService.provisionBalance(ctx.manager, T, 'a')).toBe(novProv);
    });

    it('a raise re-values the provision: same days, higher basic → positive change with zero accrual days', async () => {
      const ctx = setup();
      // b is under six months, so accrues nothing; give them 5 days by adjustment.
      await ctx.leaveService.adjust(T, 'b', ACTOR, { days: 5, note: 'Contract' }, [
        PERMISSIONS.PAYROLL_APPROVE,
      ]);
      const oct = await draft(ctx, '2026-10');
      const outOct = await ctx.service.approve(T, oct.id, APPROVER);
      expect(lineOf(outOct, 'EMP-002').leaveProvisionAfter).toBe(r2((5 * 3100) / 30));

      ctx.packages.rows.push(pkg('pb2', 'b', '2026-11-01', 4000));
      const nov = await draft(ctx, '2026-11');
      const outNov = await ctx.service.approve(T, nov.id, APPROVER);
      const b = lineOf(outNov, 'EMP-002');
      expect(b.leaveProvisionChange).toBe(r2((5 * 4000) / 30 - (5 * 3100) / 30));
      expect(b.leaveProvisionChange).toBeGreaterThan(0);
      expect(ctx.leaveLedger.rows.find((r) => r.runLineId === b.id)).toMatchObject({
        kind: 'ACCRUAL',
        days: 0,
        amount: b.leaveProvisionChange,
      });
    });

    it('approval applies the current scheme: a scheme assigned after the draft was created', async () => {
      const ctx = setup();
      addNational(ctx, null);
      const run = await draft(ctx, '2026-10');
      expect(lineOf(run, 'EMP-003').flags).toContain('NATIONAL_NO_PENSION_SCHEME');
      expect(lineOf(run, 'EMP-003').pensionEmployee).toBe(0);

      ctx.employees.rows.find((e) => e.id === 'n').pensionSchemeId = 'gpssa';
      const out = await ctx.service.approve(T, run.id, APPROVER);
      const n = lineOf(out, 'EMP-003');
      expect(n.pensionSchemeName).toBe('GPSSA');
      expect(n.pensionEmployee).toBe(3300);
      expect(n.pensionEmployer).toBe(4500);
      expect(n.netPay).toBe(26700);
      expect(n.flags).not.toContain('NATIONAL_NO_PENSION_SCHEME');
      const entry = ctx.entries.rows.find((e) => e.id === out.journalEntryId);
      expect(byRole(entry)[LEDGER_ROLES.PENSION_PAYABLE]).toEqual({
        debit: 0,
        credit: 7800,
      });
    });

    it('refuses (409) a national whose scheme is inactive, naming them', async () => {
      const ctx = setup();
      addNational(ctx);
      const run = await draft(ctx, '2026-10');
      ctx.schemes.rows.find((s) => s.id === 'gpssa').isActive = false;
      const err = await ctx.service.approve(T, run.id, APPROVER).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(
        'Assign an active pension scheme to Emp EMP-003 before approving',
      );
      expect(ctx.entries.rows).toHaveLength(0);
      expect(ctx.leaveLedger.rows).toHaveLength(0);
      expect(ctx.runs.rows[0].status).toBe('DRAFT');
    });

    it('refuses (400) unpaid plus half-pay days above the days employed', async () => {
      const ctx = setup();
      const run = await draft(ctx, '2026-10');
      const row = ctx.lines.rows.find((l) => l.employeeId === 'b');
      Object.assign(row, { leaveOverridden: true, unpaidLeaveDays: 10, halfPayDays: 10 });
      const err = await ctx.service.approve(T, run.id, APPROVER).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/Emp EMP-002/);
      expect(ctx.entries.rows).toHaveLength(0);
    });

    it('refuses (409) when leave opening balances were set up at or after the period end', async () => {
      const ctx = setup();
      const run = await draft(ctx, '2026-10');
      ctx.leaveLedger.rows.push({
        id: 'lo',
        tenantId: T,
        employeeId: 'a',
        kind: 'OPENING',
        days: 10,
        amount: 2000,
        asOf: '2026-10-31',
        runLineId: null,
      });
      const err = await ctx.service.approve(T, run.id, APPROVER).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(
        'Leave opening balances were set up as of 2026-10-31; payroll for October 2026 is already in them',
      );
      expect(ctx.entries.rows).toHaveLength(0);
    });

    it('re-applies leave from records on lines not overridden', async () => {
      const ctx = setup();
      const run = await draft(ctx, '2026-10');
      // Recorded after the draft without refilling it.
      ctx.leaveRecords.rows.push({
        id: 'lr-u',
        tenantId: T,
        employeeId: 'a',
        type: 'UNPAID',
        startDate: '2026-10-05',
        endDate: '2026-10-06',
        days: 2,
        note: null,
        createdAt: new Date('2026-10-01T00:00:00Z'),
      });
      const out = await ctx.service.approve(T, run.id, APPROVER);
      expect(lineOf(out, 'EMP-001').unpaidLeaveDays).toBe(2);
    });
  });

  describe('void', () => {
    it('reverses every journal line, nets the accruals to zero, and frees the period', async () => {
      const ctx = setup();
      const run = await draft(ctx, '2026-10');
      await ctx.runsService.updateLine(T, run.id, lineOf(run, 'EMP-001').id, {
        bonusAmount: 500,
        advanceRecovery: 1000,
        otherDeductionAmount: 200,
      } as any);
      await ctx.service.approve(T, run.id, APPROVER);
      const out = await ctx.service.void(T, run.id, APPROVER);

      expect(out.status).toBe('VOIDED');
      expect(ctx.entries.rows).toHaveLength(2);
      const [approval, reversal] = ctx.entries.rows;
      expect(reversal.entryNumber).toBe(`JE-${run.runNumber}-VOID`);
      expect(reversal.referenceType).toBe('PAYROLL');
      expect(reversal.referenceId).toBe(run.id);
      expect(ctx.runs.rows[0].voidJournalEntryId).toBe(reversal.id);
      expect(balanced(reversal)).toBe(true);
      expect(reversal.lines).toHaveLength(approval.lines.length);
      const net = new Map<string, number>();
      for (const l of [...approval.lines, ...reversal.lines]) {
        net.set(
          l.ledgerAccountId,
          (net.get(l.ledgerAccountId) ?? 0) + l.debit - l.credit,
        );
      }
      for (const v of net.values()) expect(Math.abs(v)).toBeLessThan(0.005);

      const reversals = ctx.gratuity.rows.filter((r) => r.kind === 'REVERSAL');
      expect(reversals).toHaveLength(2);
      for (const r of reversals) expect(r.journalEntryId).toBe(reversal.id);
      expect(await ctx.gratuityService.balance(ctx.manager, T, 'a')).toBe(0);
      expect(await ctx.gratuityService.balance(ctx.manager, T, 'b')).toBe(0);

      const again = await draft(ctx, '2026-10');
      expect(again.status).toBe('DRAFT');
    });

    it('writes REVERSAL rows netting leave days and amounts to zero, and reverses pension and leave lines exactly', async () => {
      const ctx = setup();
      addNational(ctx);
      annualLeave(ctx, 'a', '2026-10-12', '2026-10-13', 2);
      const run = await draft(ctx, '2026-10');
      await ctx.service.approve(T, run.id, APPROVER);
      const posted = ctx.leaveLedger.rows.length;
      expect(posted).toBe(4); // a ACCRUAL + TAKEN, b ACCRUAL, n ACCRUAL

      await ctx.service.void(T, run.id, APPROVER);

      const [approval, reversal] = ctx.entries.rows;
      expect(balanced(reversal)).toBe(true);
      const net = new Map<string, number>();
      for (const l of [...approval.lines, ...reversal.lines]) {
        net.set(l.ledgerAccountId, (net.get(l.ledgerAccountId) ?? 0) + l.debit - l.credit);
      }
      expect(net.has(`acct-${LEDGER_ROLES.PENSION_PAYABLE}`)).toBe(true);
      expect(net.has(`acct-${LEDGER_ROLES.LEAVE_PROVISION}`)).toBe(true);
      for (const v of net.values()) expect(Math.abs(v)).toBeLessThan(0.005);

      const reversals = ctx.leaveLedger.rows.filter((r) => r.kind === 'REVERSAL');
      expect(reversals).toHaveLength(posted);
      for (const r of reversals) {
        expect(r.journalEntryId).toBe(reversal.id);
        expect(r.note).toBe(`Void of payroll ${run.runNumber}`);
      }
      expect(reversals.find((r) => r.days === 2)).toMatchObject({ amount: null });
      for (const id of ['a', 'b', 'n']) {
        expect(await ctx.leaveService.balanceDays(ctx.manager, T, id)).toBe(0);
        expect(await ctx.leaveService.provisionBalance(ctx.manager, T, id)).toBe(0);
        expect(await ctx.leaveService.accrualBaseline(ctx.manager, T, id)).toBe(0);
      }
    });

    it('refuses (409) while the period has a live pension remittance', async () => {
      const ctx = setup();
      addNational(ctx);
      const run = await draft(ctx, '2026-10');
      await ctx.service.approve(T, run.id, APPROVER);
      ctx.remittances.rows.push({
        id: 'rem',
        tenantId: T,
        period: '2026-10',
        amount: 7800,
        voidedAt: null,
      });
      const err = await ctx.service.void(T, run.id, APPROVER).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe('Void the pension remittance for October 2026 first');
      expect(ctx.entries.rows).toHaveLength(1);
      expect(ctx.leaveLedger.rows.some((r) => r.kind === 'REVERSAL')).toBe(false);

      ctx.remittances.rows[0].voidedAt = new Date();
      const out = await ctx.service.void(T, run.id, APPROVER);
      expect(out.status).toBe('VOIDED');
    });

    it('refuses (409) while a leaver on the run is settled for this month', async () => {
      const ctx = setup();
      const b = ctx.employees.rows.find((e) => e.id === 'b');
      Object.assign(b, { status: 'LEFT', leavingDate: '2026-10-30' });
      const run = await draft(ctx, '2026-10');
      await ctx.service.approve(T, run.id, APPROVER);
      ctx.settlements.rows.push(
        // Another month's settlement does not depend on this run.
        {
          id: 's0',
          tenantId: T,
          settlementNumber: 'FS-0001',
          employeeId: 'a',
          employeeName: 'Emp EMP-001',
          leavingDate: '2026-11-15',
          status: 'APPROVED',
        },
        {
          id: 's1',
          tenantId: T,
          settlementNumber: 'FS-0002',
          employeeId: 'b',
          employeeName: 'Emp EMP-002',
          leavingDate: '2026-10-30',
          status: 'PAID',
        },
      );
      const err = await ctx.service.void(T, run.id, APPROVER).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(
        'FS-0002 for Emp EMP-002 depends on this run; void it first',
      );
      expect(ctx.entries.rows).toHaveLength(1);

      ctx.settlements.rows[1].status = 'VOIDED';
      const out = await ctx.service.void(T, run.id, APPROVER);
      expect(out.status).toBe('VOIDED');
    });

    it('refuses a run that has been paid (409)', async () => {
      const ctx = setup();
      const run = await draft(ctx, '2026-10');
      await ctx.service.approve(T, run.id, APPROVER);
      ctx.runs.rows[0].bankPaidAt = new Date();
      await expect(ctx.service.void(T, run.id, APPROVER)).rejects.toThrow(
        'Paid runs cannot be voided',
      );
      ctx.runs.rows[0].status = 'PARTIALLY_PAID';
      await expect(
        ctx.service.void(T, run.id, APPROVER),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(ctx.entries.rows).toHaveLength(1);
    });

    it('refuses a DRAFT run (409) and an actor without payroll:approve (403)', async () => {
      const ctx = setup();
      const run = await draft(ctx, '2026-10');
      await expect(
        ctx.service.void(T, run.id, APPROVER),
      ).rejects.toBeInstanceOf(ConflictException);
      await ctx.service.approve(T, run.id, APPROVER);
      await expect(
        ctx.service.void(T, run.id, { userId: ACTOR, permissions: [] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses (409) to void a month while a later month is posted', async () => {
      const ctx = setup();
      const oct = await draft(ctx, '2026-10');
      await ctx.service.approve(T, oct.id, APPROVER);
      const nov = await draft(ctx, '2026-11');
      await ctx.service.approve(T, nov.id, APPROVER);
      const err = await ctx.service.void(T, oct.id, APPROVER).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe('Void November 2026 first');
      expect(ctx.entries.rows).toHaveLength(2);
      // Newest first is allowed.
      await ctx.service.void(T, nov.id, APPROVER);
      const out = await ctx.service.void(T, oct.id, APPROVER);
      expect(out.status).toBe('VOIDED');
    });

    it('dates the reversal no earlier than the approval entry', async () => {
      jest.useFakeTimers({
        now: new Date('2026-10-20T10:00:00Z'),
        doNotFake: ['nextTick', 'setImmediate'],
      });
      try {
        const ctx = setup();
        const run = await draft(ctx, '2026-10');
        await ctx.service.approve(T, run.id, APPROVER);
        await ctx.service.void(T, run.id, APPROVER);
        const [approval, reversal] = ctx.entries.rows;
        expect(approval.entryDate).toEqual(
          new Date('2026-10-31T00:00:00.000Z'),
        );
        expect(reversal.entryDate).toEqual(approval.entryDate);
      } finally {
        jest.useRealTimers();
      }
    });

    it('dates the reversal today when today is after the approval date', async () => {
      jest.useFakeTimers({
        now: new Date('2026-11-05T10:00:00Z'),
        doNotFake: ['nextTick', 'setImmediate'],
      });
      try {
        const ctx = setup();
        const run = await draft(ctx, '2026-10');
        await ctx.service.approve(T, run.id, APPROVER);
        await ctx.service.void(T, run.id, APPROVER);
        expect(ctx.entries.rows[1].entryDate).toEqual(
          new Date('2026-11-05T00:00:00.000Z'),
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('pay', () => {
    const PAYER = {
      userId: ACTOR,
      permissions: [PERMISSIONS.PAYROLL_APPROVE, PERMISSIONS.PAYROLL_PAY],
    };
    const BANK_ACCT = '44444444-4444-4444-8444-444444444444';
    const CASH_ACCT = '55555555-5555-4555-8555-555555555555';
    const withAccounts = (ctx: Ctx) => {
      const accts = repo([
        { id: BANK_ACCT, tenantId: T, name: 'ENBD', currency: 'AED' },
        { id: CASH_ACCT, tenantId: T, name: 'Petty cash', currency: 'AED' },
        { id: 'usd', tenantId: T, name: 'USD acct', currency: 'USD' },
      ]);
      ctx.manager.getRepository = ((orig) => (e: any) =>
        e === FinanceAccount ? accts : orig(e))(ctx.manager.getRepository);
    };
    const approved = async (ctx: Ctx) => {
      withAccounts(ctx);
      const run = await draft(ctx, '2026-10');
      await ctx.service.approve(T, run.id, APPROVER);
      return run;
    };
    const decrements = (ctx: Ctx) =>
      ctx.manager.query.mock.calls.filter(([sql]: any) =>
        /UPDATE "finance_accounts"/.test(sql),
      );

    it('bank then cash: PARTIALLY_PAID then PAID, two balanced entries, two decrements', async () => {
      const ctx = setup();
      const run = await approved(ctx);
      ctx.runs.save.mockClear();
      const first = await ctx.service.pay(T, run.id, PAYER, {
        method: 'BANK',
        financeAccountId: BANK_ACCT,
      });
      expect(first.status).toBe('PARTIALLY_PAID');
      const bankEntry = ctx.entries.rows.find(
        (e) => e.entryNumber === `JE-${run.runNumber}-BANK`,
      );
      expect(bankEntry.referenceType).toBe('PAYROLL');
      expect(bankEntry.referenceId).toBe(run.id);
      expect(balanced(bankEntry)).toBe(true);
      expect(bankEntry.lines[0]).toMatchObject({
        role: LEDGER_ROLES.SALARIES_PAYABLE,
        debit: 8500,
      });
      expect(bankEntry.lines[1]).toMatchObject({
        financeAccountId: BANK_ACCT,
        credit: 8500,
      });
      expect(
        ctx.lines.rows.filter((l) => l.paymentMethod === 'BANK')[0].paidAt,
      ).toBeInstanceOf(Date);
      expect(
        ctx.lines.rows.filter((l) => l.paymentMethod === 'CASH')[0].paidAt,
      ).toBeFalsy();

      const second = await ctx.service.pay(T, run.id, PAYER, {
        method: 'CASH',
        financeAccountId: CASH_ACCT,
      });
      expect(second.status).toBe('PAID');
      const cashEntry = ctx.entries.rows.find(
        (e) => e.entryNumber === `JE-${run.runNumber}-CASH`,
      );
      expect(balanced(cashEntry)).toBe(true);
      expect(cashEntry.totalAmount).toBe(1600);
      expect(decrements(ctx).map(([, p]: any) => p)).toEqual([
        [8500, BANK_ACCT, T],
        [1600, CASH_ACCT, T],
      ]);
      expect(ctx.runs.save).not.toHaveBeenCalled();
      expect(ctx.runs.rows[0].bankPaidAt).toBeInstanceOf(Date);
      expect(ctx.runs.rows[0].cashPaidAt).toBeInstanceOf(Date);
    });

    it('paying bank twice is 409 and posts nothing more', async () => {
      const ctx = setup();
      const run = await approved(ctx);
      const body = { method: 'BANK' as const, financeAccountId: BANK_ACCT };
      await ctx.service.pay(T, run.id, PAYER, body);
      const err = await ctx.service.pay(T, run.id, PAYER, body).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(
        `Bank payees on ${run.runNumber} are already paid`,
      );
      expect(decrements(ctx)).toHaveLength(1);
    });

    it('a bank-only run paid by bank is PAID, and a later cash call is 409 "Nothing left to pay"', async () => {
      const ctx = setup();
      ctx.employees.rows.find((e) => e.id === 'b').paymentMethod = 'BANK';
      const run = await approved(ctx);
      const out = await ctx.service.pay(T, run.id, PAYER, {
        method: 'BANK',
        financeAccountId: BANK_ACCT,
      });
      expect(out.status).toBe('PAID');
      const err = await ctx.service
        .pay(T, run.id, PAYER, { method: 'CASH', financeAccountId: CASH_ACCT })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe('Nothing left to pay');
    });

    it('an all-bank run: paying cash is 409 with no writes, the run stays voidable; paying bank goes straight to PAID', async () => {
      const ctx = setup();
      ctx.employees.rows.find((e) => e.id === 'b').paymentMethod = 'BANK';
      const run = await approved(ctx);
      ctx.runs.update.mockClear();
      const err = await ctx.service
        .pay(T, run.id, PAYER, { method: 'CASH', financeAccountId: CASH_ACCT })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(`No cash payees on ${run.runNumber}`);
      expect(ctx.runs.update).not.toHaveBeenCalled();
      expect(ctx.runs.rows[0].status).toBe('APPROVED');
      expect(ctx.runs.rows[0].cashPaidAt ?? null).toBeNull();
      expect(decrements(ctx)).toHaveLength(0);
      expect(ctx.entries.rows).toHaveLength(1);

      const out = await ctx.service.void(T, run.id, PAYER);
      expect(out.status).toBe('VOIDED');

      const ctx2 = setup();
      ctx2.employees.rows.find((e) => e.id === 'b').paymentMethod = 'BANK';
      const run2 = await approved(ctx2);
      const paid = await ctx2.service.pay(T, run2.id, PAYER, {
        method: 'BANK',
        financeAccountId: BANK_ACCT,
      });
      expect(paid.status).toBe('PAID');
    });

    it('refuses a DRAFT run (409), a foreign-currency account (400), an unknown account (404) and no payroll:pay (403)', async () => {
      const ctx = setup();
      withAccounts(ctx);
      const run = await draft(ctx, '2026-10');
      const body = { method: 'BANK' as const, financeAccountId: BANK_ACCT };
      await expect(
        ctx.service.pay(T, run.id, PAYER, body),
      ).rejects.toBeInstanceOf(ConflictException);
      await ctx.service.approve(T, run.id, APPROVER);
      await expect(
        ctx.service.pay(T, run.id, APPROVER, body),
      ).rejects.toBeInstanceOf(ForbiddenException);
      const err = await ctx.service
        .pay(T, run.id, PAYER, { ...body, financeAccountId: 'usd' })
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Pay payroll from a AED account');
      await expect(
        ctx.service.pay(T, run.id, PAYER, { ...body, financeAccountId: 'nope' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(decrements(ctx)).toHaveLength(0);
      expect(ctx.entries.rows).toHaveLength(1);
    });

    it('locks the run and writes it by targeted update', async () => {
      const ctx = setup();
      const run = await approved(ctx);
      ctx.runs.locks.length = 0;
      await ctx.service.pay(T, run.id, PAYER, {
        method: 'BANK',
        financeAccountId: BANK_ACCT,
      });
      expect(ctx.runs.locks).toContain('pessimistic_write');
      expect(ctx.runs.update).toHaveBeenLastCalledWith(
        { id: run.id, tenantId: T },
        expect.objectContaining({ status: 'PARTIALLY_PAID' }),
      );
    });
  });

  describe('month order', () => {
    it('refuses (409) to approve a month while a later month is posted', async () => {
      const ctx = setup();
      const oct = await draft(ctx, '2026-10');
      const nov = await draft(ctx, '2026-11');
      // Nov while Oct is still a draft: drafts do not block.
      await ctx.service.approve(T, nov.id, APPROVER);
      const err = await ctx.service
        .approve(T, oct.id, APPROVER)
        .catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(
        'Payroll for November 2026 is already posted; approve runs in month order',
      );
      expect(ctx.entries.rows).toHaveLength(1);
      expect(ctx.runs.rows.find((r) => r.id === oct.id).status).toBe('DRAFT');
    });

    it('a voided later month does not block', async () => {
      const ctx = setup();
      const oct = await draft(ctx, '2026-10');
      const nov = await draft(ctx, '2026-11');
      await ctx.service.approve(T, nov.id, APPROVER);
      await ctx.service.void(T, nov.id, APPROVER);
      const out = await ctx.service.approve(T, oct.id, APPROVER);
      expect(out.status).toBe('APPROVED');
    });
  });
  describe('labour absorption', () => {
    /** An open and a completed job; EMP-001 logs 40 h, 20 h and 8 h idle in October. */
    function addJobs(ctx: Ctx) {
      for (const [id, woNumber, status] of [
        ['wo-open', 'WO-1', 'IN_PROGRESS'],
        ['wo-done', 'WO-2', 'COMPLETE'],
      ]) {
        ctx.workOrders.rows.push({
          id,
          tenantId: T,
          woNumber,
          status,
          qty: 1,
          qtyCompleted: status === 'COMPLETE' ? 1 : null,
          completedAt:
            status === 'COMPLETE' ? new Date('2026-10-20T10:00:00.000Z') : null,
          overheadPct: 0,
          estimatedCost: { tooling: 0 },
          actualCost: null,
          labourStatus: null,
          labourSplit: null,
        });
        ctx.operations.rows.push({
          id: `op-${id}`,
          tenantId: T,
          workOrderId: id,
          workCenterId: 'wc',
          workCenterName: 'Press',
          status: 'DONE',
          estimatedSetupMinutes: 0,
          estimatedRunMinutes: 60,
          estimatedChargedMinutes: 60,
          actualMinutes: 0,
          machineCostPerHour: 0,
          laborCostPerHour: 0,
        });
      }
      const entry = (
        id: string,
        day: string,
        hours: number,
        wo: string | null,
      ) =>
        ctx.timesheets.rows.push({
          id,
          tenantId: T,
          employeeId: 'a',
          workDate: `2026-10-${day}`,
          hours,
          workOrderId: wo,
          operationId: wo ? `op-${wo}` : null,
          indirectCategory: wo ? null : 'IDLE',
          runLineId: null,
        });
      entry('t1', '05', 8, 'wo-open');
      entry('t2', '06', 8, 'wo-open');
      entry('t3', '07', 8, 'wo-open');
      entry('t4', '08', 8, 'wo-open');
      entry('t5', '09', 8, 'wo-open');
      entry('t6', '12', 10, 'wo-done');
      entry('t7', '13', 10, 'wo-done');
      entry('t8', '14', 8, null);
    }

    const lockEvents = () =>
      events.filter((e) => e.startsWith('lock:') || e.startsWith('advisory:'));

    it('approval posts JE-<run>-LAB at cost ÷ standard hours and persists the line labour columns', async () => {
      const ctx = setup();
      addJobs(ctx);
      const run = await draft(ctx, '2026-10');
      const out = await ctx.service.approve(T, run.id, APPROVER);

      const a = ctx.lines.rows.find((l) => l.employeeId === 'a');
      // cost = salary + pension + gratuity + leave provision, over 208 h.
      const cost = r2(
        a.salaryCost +
          a.pensionEmployer +
          a.gratuityAccrual +
          a.leaveProvisionChange,
      );
      const rate = Math.round((cost / 208) * 10000) / 10000;
      expect(a).toMatchObject({
        standardHours: 208,
        loggedHours: 68,
        directHours: 60,
        labourRate: rate,
      });
      // Each entry rounds on its own; the remainder goes on the largest (10 h, WO-2).
      const total = r2(60 * rate);
      const wip = r2(5 * r2(8 * rate));
      const cogs = r2(total - wip);
      expect(a.labourAbsorbed).toBe(total);
      expect(a.labourAbsorbed).toBeLessThanOrEqual(cost);
      expect(lineOf(out, 'EMP-001').labourAbsorbed).toBe(a.labourAbsorbed);
      expect(out.totals.labourAbsorbed).toBe(a.labourAbsorbed);

      const lab = ctx.entries.rows.find(
        (e) => e.entryNumber === `JE-${run.runNumber}-LAB`,
      );
      expect(balanced(lab)).toBe(true);
      expect(byRole(lab)).toEqual({
        [LEDGER_ROLES.WIP]: { debit: wip, credit: 0 },
        [LEDGER_ROLES.COGS]: { debit: cogs, credit: 0 },
        [LEDGER_ROLES.LABOUR_ABSORBED]: { debit: 0, credit: r2(wip + cogs) },
      });
      expect(lab.entryDate).toEqual(new Date('2026-10-31T00:00:00.000Z'));
      const stored = ctx.runs.rows.find((r) => r.id === run.id);
      expect(stored.labourJournalEntryId).toBe(lab.id);
      expect(stored.totalLabourAbsorbed).toBe(a.labourAbsorbed);

      expect(
        ctx.labourRows.rows.map((r) => [r.workOrderId, r.account, r.hours]),
      ).toEqual(
        expect.arrayContaining([
          ['wo-open', 'WIP', 40],
          ['wo-done', 'COGS', 20],
        ]),
      );
      expect(ctx.timesheets.rows.every((e) => e.runLineId === a.id)).toBe(
        true,
      );
      // The completed job is recomputed from the absorbed amount.
      expect(
        ctx.workOrders.rows.find((w) => w.id === 'wo-done').labourStatus,
      ).toBe('ACTUAL');
    });

    it('leaves the payroll journal exactly as it is without timesheets', async () => {
      const plain = setup();
      const plainRun = await draft(plain, '2026-10');
      await plain.service.approve(T, plainRun.id, APPROVER);
      const withJobs = setup();
      addJobs(withJobs);
      const jobsRun = await draft(withJobs, '2026-10');
      await withJobs.service.approve(T, jobsRun.id, APPROVER);
      const main = (ctx: Ctx, n: string) =>
        ctx.entries.rows.find((e) => e.entryNumber === `JE-${n}`);
      expect(byRole(main(withJobs, jobsRun.runNumber))).toEqual(
        byRole(main(plain, plainRun.runNumber)),
      );
      expect(plain.entries.rows).toHaveLength(1);
      expect(withJobs.entries.rows).toHaveLength(2);
    });

    it('lock order: run row, gratuity opening, job costing, then work orders; entries read only after the job-costing lock', async () => {
      const ctx = setup();
      addJobs(ctx);
      const run = await draft(ctx, '2026-10');
      events.length = 0;
      await ctx.service.approve(T, run.id, APPROVER);
      expect(lockEvents()).toEqual([
        'lock:PayrollRun',
        'advisory:gratuity-opening',
        'advisory:job-costing',
        'lock:WorkOrder',
      ]);
      expect(events.indexOf('read:TimesheetEntry')).toBeGreaterThan(
        events.indexOf('advisory:job-costing'),
      );

      events.length = 0;
      await ctx.service.void(T, run.id, APPROVER);
      expect(lockEvents()).toEqual([
        'lock:PayrollRun',
        'advisory:gratuity-opening',
        'advisory:job-costing',
        'lock:WorkOrder',
      ]);
    });

    it('void after completion reverses from COGS, deletes the rows, unstamps the entries and recomputes', async () => {
      const ctx = setup();
      addJobs(ctx);
      const run = await draft(ctx, '2026-10');
      await ctx.service.approve(T, run.id, APPROVER);
      const a = ctx.lines.rows.find((l) => l.employeeId === 'a');
      // Completion (Task 9) moves the open job's WIP labour to COGS.
      const open = ctx.workOrders.rows.find((w) => w.id === 'wo-open');
      open.status = 'COMPLETE';
      open.qtyCompleted = 1;
      ctx.labourRows.rows.find((r) => r.workOrderId === 'wo-open').clearedTo =
        'COGS';

      await ctx.service.void(T, run.id, APPROVER);

      const v = ctx.entries.rows.find(
        (e) => e.entryNumber === `JE-${run.runNumber}-LAB-VOID`,
      );
      expect(byRole(v)).toEqual({
        [LEDGER_ROLES.LABOUR_ABSORBED]: { debit: a.labourAbsorbed, credit: 0 },
        [LEDGER_ROLES.COGS]: { debit: 0, credit: a.labourAbsorbed },
      });
      // The payroll's own exact reversal is untouched (J10).
      const payrollVoid = ctx.entries.rows.find(
        (e) => e.entryNumber === `JE-${run.runNumber}-VOID`,
      );
      expect(
        payrollVoid.lines.some(
          (l: any) =>
            l.ledgerAccountId === `acct-${LEDGER_ROLES.COGS}` ||
            l.ledgerAccountId === `acct-${LEDGER_ROLES.LABOUR_ABSORBED}`,
        ),
      ).toBe(false);
      const stored = ctx.runs.rows.find((r) => r.id === run.id);
      expect(stored.labourVoidJournalEntryId).toBe(v.id);
      expect(stored.status).toBe('VOIDED');
      expect(ctx.labourRows.rows).toHaveLength(0);
      expect(ctx.timesheets.rows.every((e) => e.runLineId === null)).toBe(true);
      for (const w of ctx.workOrders.rows) {
        expect(w.labourStatus).toBe('PROVISIONAL');
      }
    });

    it('approve → complete → void → a fresh run for the month re-absorbs to COGS and re-stamps the entries', async () => {
      const ctx = setup();
      addJobs(ctx);
      const first = await draft(ctx, '2026-10');
      await ctx.service.approve(T, first.id, APPROVER);
      expect(
        ctx.labourRows.rows.find((r) => r.workOrderId === 'wo-open').account,
      ).toBe('WIP');
      // Completion (Task 9) within the month moves the WIP labour to COGS.
      const open = ctx.workOrders.rows.find((w) => w.id === 'wo-open');
      open.status = 'COMPLETE';
      open.qtyCompleted = 1;
      open.completedAt = new Date('2026-10-30T12:00:00.000Z');
      ctx.labourRows.rows.find((r) => r.workOrderId === 'wo-open').clearedTo =
        'COGS';
      await ctx.service.void(T, first.id, APPROVER);
      expect(ctx.timesheets.rows.every((e) => e.runLineId === null)).toBe(true);

      const second = await draft(ctx, '2026-10');
      expect(second.id).not.toBe(first.id);
      await ctx.service.approve(T, second.id, APPROVER);
      const a = ctx.lines.rows.find(
        (l) => l.employeeId === 'a' && l.runId === second.id,
      );
      const stored = ctx.runs.rows.find((r) => r.id === second.id);
      const lab = ctx.entries.rows.find(
        (e) => e.id === stored.labourJournalEntryId,
      );
      expect(lab.entryNumber).toBe(`JE-${stored.runNumber}-LAB`);
      // Both jobs are now complete by the period end: all of it is COGS.
      expect(byRole(lab)).toEqual({
        [LEDGER_ROLES.COGS]: { debit: a.labourAbsorbed, credit: 0 },
        [LEDGER_ROLES.LABOUR_ABSORBED]: { debit: 0, credit: a.labourAbsorbed },
      });
      expect(a.labourAbsorbed).toBeGreaterThan(0);
      expect(
        ctx.labourRows.rows.map((r) => [r.workOrderId, r.account, r.runId]),
      ).toEqual(
        expect.arrayContaining([
          ['wo-open', 'COGS', second.id],
          ['wo-done', 'COGS', second.id],
        ]),
      );
      expect(ctx.labourRows.rows).toHaveLength(2);
      expect(ctx.timesheets.rows.every((e) => e.runLineId === a.id)).toBe(true);
      for (const w of ctx.workOrders.rows) {
        expect(w.labourStatus).toBe('ACTUAL');
      }
    });

    it('void with nothing absorbed posts no labour journal', async () => {
      const ctx = setup();
      const run = await draft(ctx, '2026-10');
      await ctx.service.approve(T, run.id, APPROVER);
      await ctx.service.void(T, run.id, APPROVER);
      expect(ctx.entries.rows.map((e) => e.entryNumber)).toEqual([
        `JE-${run.runNumber}`,
        `JE-${run.runNumber}-VOID`,
      ]);
      const stored = ctx.runs.rows.find((r) => r.id === run.id);
      expect(stored.labourJournalEntryId ?? null).toBeNull();
      expect(stored.labourVoidJournalEntryId ?? null).toBeNull();
    });
  });
});
