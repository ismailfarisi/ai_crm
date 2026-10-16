import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { gratuityEntitlement, LEDGER_ROLES, PERMISSIONS } from '@saas/shared';
import { Organization } from '../organizations/entities/organization.entity';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { Employee } from './entities/employee.entity';
import { SalaryPackage } from './entities/salary-package.entity';
import { EmployeeAdvance } from './entities/employee-advance.entity';
import { PayrollRun, PayrollRunLine } from './entities/payroll-run.entity';
import { GratuityLedgerEntry } from './entities/gratuity-ledger-entry.entity';
import { EmployeesService } from './employees.service';
import { PayrollCryptoService } from './payroll-crypto.service';
import { AdvancesService } from './advances.service';
import { GratuityService } from './gratuity.service';
import { PayrollRunsService } from './payroll-runs.service';
import { PayrollPostingService } from './payroll-posting.service';

const T = '11111111-1111-4111-8111-111111111111';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const APPROVER = { userId: ACTOR, permissions: [PERMISSIONS.PAYROLL_APPROVE] };
const ADVISORY = 'SELECT pg_advisory_xact_lock(hashtext($1))';

function repo(rows: any[]) {
  let n = 0;
  const locks: string[] = [];
  const match = (r: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => r[k] === v);
  return {
    rows,
    locks,
    create: (d: any) => ({ ...d }),
    find: jest.fn(async ({ where }: any = {}) =>
      rows.filter((r) => match(r, where)),
    ),
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
    createQueryBuilder: jest.fn(() => {
      const params: any = {};
      const qb: any = {
        setLock: jest.fn((mode: string) => {
          locks.push(mode);
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
  const runs = repo([]);
  const lines = repo([]);
  const gratuity = repo([]);
  const entries = repo([]);
  const orgs = repo([{ id: T, name: 'Acme', baseCurrency: 'AED' }]);
  const repos = new Map<any, any>([
    [Employee, employees],
    [SalaryPackage, packages],
    [EmployeeAdvance, advances],
    [PayrollRun, runs],
    [PayrollRunLine, lines],
    [GratuityLedgerEntry, gratuity],
    [JournalEntry, entries],
    [Organization, orgs],
  ]);
  let seq = 0;
  const calls: string[] = [];
  const manager: any = {
    getRepository: (e: any) => repos.get(e),
    query: jest.fn(async (sql: string) => {
      calls.push(sql);
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
  const runsService = new PayrollRunsService(
    dataSource,
    employeesService,
    advancesService,
    gratuityService,
  );
  const service = new PayrollPostingService(
    dataSource,
    ledger,
    runsService,
    advancesService,
    gratuityService,
  );
  return {
    service,
    runsService,
    gratuityService,
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
      // a: 8500 + 500 bonus = 9000 cost, net 7800; b: 1600 prorated.
      expect(byRole(entry)).toEqual({
        [LEDGER_ROLES.SALARIES]: { debit: 10600, credit: 200 },
        [LEDGER_ROLES.SALARIES_PAYABLE]: { debit: 0, credit: 9400 },
        [LEDGER_ROLES.EMPLOYEE_ADVANCES]: { debit: 0, credit: 1000 },
        [LEDGER_ROLES.GRATUITY_EXPENSE]: { debit: G, credit: 0 },
        [LEDGER_ROLES.GRATUITY_PROVISION]: { debit: 0, credit: G },
      });
      expect(entry.totalAmount).toBeCloseTo(10600 + G, 2);
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
      ctx.employees.rows.push(emp('g', 'EMP-007', { isNational: true }));
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
      row.unpaidLeaveDays = 20; // employed 16 days
      await expect(ctx.service.approve(T, run.id, APPROVER)).rejects.toThrow(
        /Emp EMP-002/,
      );
      expect(ctx.entries.rows).toHaveLength(0);
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
});
