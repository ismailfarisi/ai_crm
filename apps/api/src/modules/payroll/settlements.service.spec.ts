import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { gratuityEntitlement, LEDGER_ROLES, PERMISSIONS, round2 } from '@saas/shared';
import { FinanceAccount } from '../finance/entities/finance-account.entity';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { Employee } from './entities/employee.entity';
import { SalaryPackage } from './entities/salary-package.entity';
import { EmployeeAdvance } from './entities/employee-advance.entity';
import { PayrollRun, PayrollRunLine } from './entities/payroll-run.entity';
import { GratuityLedgerEntry } from './entities/gratuity-ledger-entry.entity';
import { LeaveRecord } from './entities/leave-record.entity';
import { LeaveLedgerEntry } from './entities/leave-ledger-entry.entity';
import { PayrollSettings } from './entities/payroll-settings.entity';
import { Settlement, SettlementLine } from './entities/settlement.entity';
import { EmployeesService } from './employees.service';
import { PayrollCryptoService } from './payroll-crypto.service';
import { AdvancesService } from './advances.service';
import { GratuityService } from './gratuity.service';
import { PayrollSettingsService } from './payroll-settings.service';
import { LeaveService } from './leave.service';
import { SettlementsService } from './settlements.service';

const T = '11111111-1111-4111-8111-111111111111';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const BANK = '44444444-4444-4444-8444-444444444444';
const APPROVER = { userId: ACTOR, permissions: [PERMISSIONS.PAYROLL_APPROVE] };
const PAYER = { userId: ACTOR, permissions: [PERMISSIONS.PAYROLL_PAY] };
const ADVISORY = 'pg_advisory_xact_lock';
const YEAR = new Date().getFullYear();
const FS1 = `FS-${YEAR}-0001`;

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
        if (!x.id) x.id = `id-${++n}-${Math.random().toString(36).slice(2, 6)}`;
        x.createdAt ??= new Date('2026-10-20T00:00:00Z');
        x.updatedAt ??= new Date('2026-10-20T00:00:00Z');
        rows.push(x);
        return x;
      });
      return Array.isArray(e) ? out : out[0];
    }),
    update: jest.fn(async (where: any, patch: any) => {
      for (const r of rows.filter((x) => match(x, where)))
        Object.assign(r, patch);
      return { affected: 1 };
    }),
    delete: jest.fn(async (where: any) => {
      for (let i = rows.length - 1; i >= 0; i--)
        if (match(rows[i], where)) rows.splice(i, 1);
      return { affected: 1 };
    }),
    createQueryBuilder: jest.fn(() => {
      const params: any = {};
      const qb: any = {
        setLock: jest.fn((mode: string) => (locks.push(mode), qb)),
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
  joiningDate: '2023-09-01',
  leavingDate: '2026-09-15',
  status: 'LEFT',
  isNational: false,
  paymentMethod: 'BANK',
  bankName: 'ENBD',
  ibanEncrypted: 'cipher',
  ibanLast4: '1234',
  ...over,
});

const pkg = (id: string, employeeId: string, from: string, basic: number, housing = 0, transport = 0) => ({
  id,
  tenantId: T,
  employeeId,
  effectiveFrom: from,
  basic,
  housing,
  transport,
  otherAllowances: [],
});

const grat = (employeeId: string, kind: string, amount: number) => ({
  id: `g-${employeeId}-${kind}-${amount}`,
  tenantId: T,
  employeeId,
  kind,
  amount,
  asOf: '2026-08-31',
  runLineId: null,
  settlementId: null,
  journalEntryId: null,
  note: null,
  createdAt: new Date('2026-09-01T00:00:00Z'),
});

const leaveRow = (employeeId: string, kind: string, days: number, amount: number | null) => ({
  id: `lv-${employeeId}-${kind}-${days}`,
  tenantId: T,
  employeeId,
  kind,
  days,
  amount,
  asOf: '2026-08-31',
  runLineId: null,
  settlementId: null,
  journalEntryId: null,
  note: null,
  createdAt: new Date('2026-09-01T00:00:00Z'),
});

/**
 * x: 3 years' service (2023-09-01 → 2026-09-15), basic 6000, gross 8500,
 *    provision 12,500 (incl. a 500 adjustment), 20 leave days carried at
 *    3,800, a 3,000 advance outstanding.
 * y: 8 months (2026-01-16 → 2026-09-15), basic 3000, provision 1,400,
 *    16 days carried at 1,600.
 * z: still active.
 */
function setup(opts: { finalRunStatus?: string } = {}) {
  const employees = repo([
    emp('x', 'EMP-010'),
    emp('y', 'EMP-011', { joiningDate: '2026-01-16' }),
    emp('z', 'EMP-012', { status: 'ACTIVE', leavingDate: null }),
  ]);
  const packages = repo([
    pkg('px', 'x', '2023-09-01', 6000, 2000, 500),
    pkg('py', 'y', '2026-01-16', 3000),
    pkg('pz', 'z', '2023-09-01', 4000),
  ]);
  const advances = repo([{ id: 'adv1', tenantId: T, employeeId: 'x', amount: 3000 }]);
  const runs = repo([
    { id: 'r9', tenantId: T, runNumber: 'PR-0009', period: '2026-09', status: opts.finalRunStatus ?? 'APPROVED' },
  ]);
  const lines = repo([
    { id: 'l9x', tenantId: T, runId: 'r9', employeeId: 'x', unpaidLeaveDays: 0, advanceRecovery: 0 },
    { id: 'l9y', tenantId: T, runId: 'r9', employeeId: 'y', unpaidLeaveDays: 0, advanceRecovery: 0 },
  ]);
  const gratuity = repo([
    grat('x', 'ACCRUAL', 12000),
    grat('x', 'ADJUSTMENT', 500),
    grat('y', 'ACCRUAL', 1400),
  ]);
  const leaveLedger = repo([
    leaveRow('x', 'ACCRUAL', 20, 3800),
    leaveRow('y', 'ACCRUAL', 16, 1600),
  ]);
  const settlements = repo([]);
  const settlementLines = repo([]);
  const entries = repo([]);
  const accounts = repo([
    { id: BANK, tenantId: T, name: 'ENBD', currency: 'AED' },
    { id: 'usd', tenantId: T, name: 'USD acct', currency: 'USD' },
  ]);
  const repos = new Map<any, any>([
    [Employee, employees],
    [SalaryPackage, packages],
    [EmployeeAdvance, advances],
    [PayrollRun, runs],
    [PayrollRunLine, lines],
    [GratuityLedgerEntry, gratuity],
    [LeaveRecord, repo([])],
    [LeaveLedgerEntry, leaveLedger],
    [PayrollSettings, repo([])],
    [Settlement, settlements],
    [SettlementLine, settlementLines],
    [JournalEntry, entries],
    [FinanceAccount, accounts],
    [Organization, repo([{ id: T, name: 'Acme', legalName: 'Acme LLC', city: 'Dubai', country: 'AE', baseCurrency: 'AED' }])],
  ]);
  let seq = 0;
  const manager: any = {
    getRepository: (e: any) => repos.get(e),
    query: jest.fn(async () => [{ current_value: ++seq }]),
  };
  const dataSource: any = { manager, transaction: (cb: any) => cb(manager) };
  const ledger: any = {
    resolveLines: jest.fn(async (_t: string, input: any[]) => {
      const d = input.reduce((s, l) => s + l.debit - l.credit, 0);
      if (Math.abs(d) > 0.005) throw new Error(`unbalanced by ${d}`);
      return input.map((l) => ({
        ...l,
        ledgerAccountId: l.ledgerAccountId ?? `acct-${l.role ?? l.financeAccountId}`,
      }));
    }),
  };
  const employeesService = new EmployeesService(dataSource, new PayrollCryptoService({}));
  const advancesService = new AdvancesService(dataSource, ledger);
  const gratuityService = new GratuityService(dataSource, ledger, employeesService);
  const leaveService = new LeaveService(
    dataSource,
    gratuityService,
    new PayrollSettingsService(dataSource),
    ledger,
    employeesService,
  );
  const service = new SettlementsService(
    dataSource,
    ledger,
    employeesService,
    advancesService,
    gratuityService,
    leaveService,
  );
  return {
    service,
    manager,
    ledger,
    gratuityService,
    leaveService,
    advancesService,
    employees,
    advances,
    runs,
    lines,
    gratuity,
    leaveLedger,
    settlements,
    settlementLines,
    entries,
  };
}

type Ctx = ReturnType<typeof setup>;

const statutoryX = gratuityEntitlement({
  joiningDate: '2023-09-01',
  asOf: '2026-09-15',
  basic: 6000,
  unpaidLeaveDays: 0,
  isNational: false,
}).amount;
const G_X = round2(statutoryX + 500);

const lineOf = (dto: any, kind: string) => dto.lines.find((l: any) => l.kind === kind);
const sumOf = (ctx: Ctx, repoName: 'gratuity' | 'leaveLedger', employeeId: string, field: 'amount' | 'days') =>
  round2(ctx[repoName].rows.filter((r: any) => r.employeeId === employeeId).reduce((s: number, r: any) => s + (r[field] ?? 0), 0));
/** Signed net (debit − credit) per role in an entry. */
const byRole = (entry: any) => {
  const out: Record<string, number> = {};
  for (const l of entry.lines) {
    const k = l.role ?? l.financeAccountId ?? String(l.ledgerAccountId).replace(/^acct-/, '');
    out[k] = round2((out[k] ?? 0) + l.debit - l.credit);
  }
  return out;
};

describe('SettlementsService', () => {
  describe('create', () => {
    it('refuses an employee who has not left', async () => {
      const ctx = setup();
      const err = await ctx.service.create(T, ACTOR, { employeeId: 'z', reason: 'RESIGNATION' }).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Only employees who have left can be settled');
    });

    it("refuses until the leaver's final month is posted", async () => {
      const ctx = setup({ finalRunStatus: 'DRAFT' });
      const err = await ctx.service.create(T, ACTOR, { employeeId: 'x', reason: 'RESIGNATION' }).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe("Approve payroll for September 2026 first: it is Emp EMP-010's final month");
    });

    it('refuses a second live settlement, naming the first', async () => {
      const ctx = setup();
      await ctx.service.create(T, ACTOR, { employeeId: 'x', reason: 'RESIGNATION' });
      const err = await ctx.service.create(T, ACTOR, { employeeId: 'x', reason: 'RESIGNATION' }).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(`Emp EMP-010 already has settlement ${FS1}`);
    });

    it('maps a racing duplicate (23505) to 409', async () => {
      const ctx = setup();
      ctx.settlements.save.mockImplementationOnce(async () => {
        throw new QueryFailedError('INSERT', [], Object.assign(new Error('dup'), { code: '23505' }));
      });
      const err = await ctx.service.create(T, ACTOR, { employeeId: 'x', reason: 'RESIGNATION' }).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
    });

    it('computes gratuity, leave encashment on basic ÷ 30 and full advance recovery (3 years)', async () => {
      const ctx = setup();
      const dto = await ctx.service.create(T, ACTOR, { employeeId: 'x', reason: 'RESIGNATION' });
      expect(dto).toMatchObject({
        settlementNumber: FS1,
        status: 'DRAFT',
        employeeName: 'Emp EMP-010',
        leavingDate: '2026-09-15',
        serviceDays: 1111,
        basic: 6000,
        gross: 8500,
        leaveBalanceDays: 20,
        paymentMethod: 'BANK',
      });
      expect(lineOf(dto, 'GRATUITY')).toMatchObject({ amount: G_X, label: 'End-of-service gratuity (3.04 years)' });
      expect(lineOf(dto, 'LEAVE_ENCASHMENT')).toMatchObject({ quantity: 20, rate: 200, amount: 4000 });
      expect(lineOf(dto, 'ADVANCE_RECOVERY')).toMatchObject({ amount: -3000 });
      expect(lineOf(dto, 'NOTICE_PAY')).toBeUndefined();
      expect(dto.netPay).toBe(round2(G_X + 4000 - 3000));
    });

    it('under a year: no statutory gratuity, adjustments still paid; a negative leave balance is a deduction', async () => {
      const ctx = setup();
      ctx.employees.rows.find((e) => e.id === 'y')!.joiningDate = '2026-02-28'; // 200 days
      ctx.gratuity.rows.push(grat('y', 'ADJUSTMENT', 300));
      ctx.leaveLedger.rows.push(leaveRow('y', 'TAKEN', -21, null)); // 16 − 21 = −5
      const dto = await ctx.service.create(T, ACTOR, { employeeId: 'y', reason: 'TERMINATION' });
      expect(dto.serviceDays).toBe(200);
      expect(lineOf(dto, 'GRATUITY').amount).toBe(300);
      expect(lineOf(dto, 'LEAVE_ENCASHMENT')).toMatchObject({ quantity: -5, amount: -500 });
      expect(lineOf(dto, 'ADVANCE_RECOVERY')).toBeUndefined();
      expect(dto.netPay).toBe(-200);
    });

    it('a national: service days counted directly though the statutory gratuity is 0', async () => {
      const ctx = setup();
      ctx.employees.rows.find((e) => e.id === 'x')!.isNational = true;
      const dto = await ctx.service.create(T, ACTOR, { employeeId: 'x', reason: 'RESIGNATION' });
      expect(dto.serviceDays).toBe(1111);
      expect(lineOf(dto, 'GRATUITY').amount).toBe(500);
    });
  });

  describe('update', () => {
    it('adds notice pay paid in lieu, then deducted; lowers encashment days; replaces manual lines; recomputes net', async () => {
      const ctx = setup();
      const { id } = await ctx.service.create(T, ACTOR, { employeeId: 'x', reason: 'RESIGNATION' });

      let dto = await ctx.service.update(T, id, { noticeDays: 10, noticeDirection: 'PAY' });
      expect(lineOf(dto, 'NOTICE_PAY')).toMatchObject({ quantity: 10, amount: 2833.33, label: 'Notice pay in lieu' });
      expect(dto.netPay).toBe(round2(G_X + 4000 - 3000 + 2833.33));

      dto = await ctx.service.update(T, id, { noticeDirection: 'DEDUCT' });
      expect(lineOf(dto, 'NOTICE_PAY')).toMatchObject({ quantity: 10, amount: -2833.33, label: 'Notice not served' });

      dto = await ctx.service.update(T, id, {
        leaveEncashmentDays: 12.5,
        advanceRecovery: 1000,
        reason: 'END_OF_CONTRACT',
        manualLines: [
          { kind: 'ADDITION', label: 'Air ticket', amount: 1500 },
          { kind: 'DEDUCTION', label: 'Laptop damage', amount: 400 },
        ],
      });
      expect(dto.reason).toBe('END_OF_CONTRACT');
      expect(lineOf(dto, 'LEAVE_ENCASHMENT')).toMatchObject({ quantity: 12.5, amount: 2500 });
      expect(lineOf(dto, 'ADVANCE_RECOVERY').amount).toBe(-1000);
      expect(lineOf(dto, 'ADDITION')).toMatchObject({ label: 'Air ticket', amount: 1500 });
      expect(lineOf(dto, 'DEDUCTION')).toMatchObject({ label: 'Laptop damage', amount: -400 });
      expect(dto.netPay).toBe(round2(G_X + 2500 - 2833.33 - 1000 + 1500 - 400));

      dto = await ctx.service.update(T, id, { noticeDays: 0, manualLines: [] });
      expect(lineOf(dto, 'NOTICE_PAY')).toBeUndefined();
      expect(lineOf(dto, 'ADDITION')).toBeUndefined();
      expect(dto.netPay).toBe(round2(G_X + 2500 - 1000));
    });

    it('caps advance recovery at what is outstanding', async () => {
      const ctx = setup();
      const { id } = await ctx.service.create(T, ACTOR, { employeeId: 'x', reason: 'RESIGNATION' });
      const dto = await ctx.service.update(T, id, { advanceRecovery: 9000 });
      expect(lineOf(dto, 'ADVANCE_RECOVERY').amount).toBe(-3000);
    });

    it('refuses encashment days above the balance, and any change to a negative balance', async () => {
      const ctx = setup();
      const { id } = await ctx.service.create(T, ACTOR, { employeeId: 'x', reason: 'RESIGNATION' });
      const err = await ctx.service.update(T, id, { leaveEncashmentDays: 21 }).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Only 20 days of leave are untaken');

      ctx.leaveLedger.rows.push(leaveRow('y', 'TAKEN', -21, null));
      const y = await ctx.service.create(T, ACTOR, { employeeId: 'y', reason: 'RESIGNATION' });
      const err2 = await ctx.service.update(T, y.id, { leaveEncashmentDays: 0 }).catch((e) => e);
      expect(err2).toBeInstanceOf(BadRequestException);
      expect(err2.message).toBe('Leave taken in advance is deducted in full');
    });

    it('only a draft can be edited, refreshed or deleted', async () => {
      const ctx = setup();
      const { id } = await ctx.service.create(T, ACTOR, { employeeId: 'y', reason: 'RESIGNATION' });
      await ctx.service.approve(T, id, APPROVER);
      for (const p of [
        ctx.service.update(T, id, { noticeDays: 1 }),
        ctx.service.refresh(T, id),
        ctx.service.remove(T, id),
      ]) {
        await expect(p).rejects.toBeInstanceOf(ConflictException);
      }
    });

    it('remove deletes a draft and its lines', async () => {
      const ctx = setup();
      const { id } = await ctx.service.create(T, ACTOR, { employeeId: 'x', reason: 'RESIGNATION' });
      await ctx.service.remove(T, id);
      expect(ctx.settlements.rows).toHaveLength(0);
      expect(ctx.settlementLines.rows).toHaveLength(0);
    });
  });

  describe('approve', () => {
    it('3 years, positive leave, an advance and a notice deduction: posts exactly these amounts and clears both ledgers', async () => {
      const ctx = setup();
      const { id } = await ctx.service.create(T, ACTOR, { employeeId: 'x', reason: 'RESIGNATION' });
      await ctx.service.update(T, id, { noticeDays: 10, noticeDirection: 'DEDUCT' });
      const dto = await ctx.service.approve(T, id, APPROVER);

      const net = round2(G_X + 4000 - 2833.33 - 3000);
      expect(dto).toMatchObject({ status: 'APPROVED', netPay: net });
      expect(dto.approvedAt).not.toBeNull();
      const entry = ctx.entries.rows[0];
      expect(entry).toMatchObject({
        entryNumber: `JE-${FS1}`,
        referenceType: 'SETTLEMENT',
        referenceId: id,
        currency: 'AED',
      });
      expect(dto.journalEntryId).toBe(entry.id);
      expect(byRole(entry)).toEqual({
        [LEDGER_ROLES.GRATUITY_PROVISION]: 12500,
        [LEDGER_ROLES.GRATUITY_EXPENSE]: round2(G_X - 12500),
        [LEDGER_ROLES.LEAVE_PROVISION]: 3800,
        [LEDGER_ROLES.LEAVE_EXPENSE]: 200,
        [LEDGER_ROLES.SALARIES]: -2833.33,
        [LEDGER_ROLES.EMPLOYEE_ADVANCES]: -3000,
        [LEDGER_ROLES.SALARIES_PAYABLE]: -net,
      });
      const debits = round2(entry.lines.reduce((s: number, l: any) => s + l.debit, 0));
      const credits = round2(entry.lines.reduce((s: number, l: any) => s + l.credit, 0));
      expect(debits).toBe(credits);
      expect(entry.totalAmount).toBe(debits);

      expect(sumOf(ctx, 'gratuity', 'x', 'amount')).toBe(0);
      expect(sumOf(ctx, 'leaveLedger', 'x', 'amount')).toBe(0);
      expect(sumOf(ctx, 'leaveLedger', 'x', 'days')).toBe(0);
      expect(ctx.gratuity.rows.at(-1)).toMatchObject({
        kind: 'SETTLEMENT',
        amount: -12500,
        asOf: '2026-09-15',
        settlementId: id,
        journalEntryId: entry.id,
      });
      expect(ctx.leaveLedger.rows.at(-1)).toMatchObject({
        kind: 'ENCASHMENT',
        days: -20,
        amount: -3800,
        asOf: '2026-09-15',
        settlementId: id,
        journalEntryId: entry.id,
      });

      // The settlement recovered the advance.
      expect(await ctx.advancesService.outstanding(ctx.manager, T, 'x')).toBe(0);
    });

    it('8 months: the gratuity provision is credited back to expense', async () => {
      const ctx = setup();
      const { id } = await ctx.service.create(T, ACTOR, { employeeId: 'y', reason: 'RESIGNATION' });
      const dto = await ctx.service.approve(T, id, APPROVER);
      expect(lineOf(dto, 'GRATUITY').amount).toBe(0);
      expect(dto.netPay).toBe(1600);
      expect(byRole(ctx.entries.rows[0])).toEqual({
        [LEDGER_ROLES.GRATUITY_PROVISION]: 1400,
        [LEDGER_ROLES.GRATUITY_EXPENSE]: -1400,
        [LEDGER_ROLES.LEAVE_PROVISION]: 1600,
        [LEDGER_ROLES.SALARIES_PAYABLE]: -1600,
      });
      expect(sumOf(ctx, 'gratuity', 'y', 'amount')).toBe(0);
      expect(sumOf(ctx, 'leaveLedger', 'y', 'days')).toBe(0);
    });

    it('locks the settlement row, then the tenant advisory lock', async () => {
      const ctx = setup();
      const { id } = await ctx.service.create(T, ACTOR, { employeeId: 'y', reason: 'RESIGNATION' });
      ctx.manager.query.mockClear();
      await ctx.service.approve(T, id, APPROVER);
      expect(ctx.settlements.locks).toEqual(['pessimistic_write']);
      expect(ctx.manager.query.mock.calls[0][0]).toContain(ADVISORY);
    });

    it('refuses to approve a stale settlement after a gratuity adjustment; refresh then approve succeeds', async () => {
      const ctx = setup();
      const { id } = await ctx.service.create(T, ACTOR, { employeeId: 'x', reason: 'RESIGNATION' });
      await ctx.gratuityService.adjust(T, 'x', ACTOR, { amount: 1000, note: 'Contract' });
      const err = await ctx.service.approve(T, id, APPROVER).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(`Balances changed since ${FS1} was drafted; refresh it`);
      expect(ctx.settlements.rows[0].status).toBe('DRAFT');

      const refreshed = await ctx.service.refresh(T, id);
      expect(lineOf(refreshed, 'GRATUITY').amount).toBe(round2(G_X + 1000));
      const dto = await ctx.service.approve(T, id, APPROVER);
      expect(dto.status).toBe('APPROVED');
      expect(sumOf(ctx, 'gratuity', 'x', 'amount')).toBe(0);
    });

    it('refuses a stale settlement after a leave adjustment', async () => {
      const ctx = setup();
      const { id } = await ctx.service.create(T, ACTOR, { employeeId: 'x', reason: 'RESIGNATION' });
      await ctx.leaveService.adjust(T, 'x', ACTOR, { days: -2, note: 'Taken' }, [PERMISSIONS.PAYROLL_APPROVE]);
      const err = await ctx.service.approve(T, id, APPROVER).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(`Balances changed since ${FS1} was drafted; refresh it`);
    });

    it('refuses when the advance recovered exceeds what is now outstanding', async () => {
      const ctx = setup();
      const { id } = await ctx.service.create(T, ACTOR, { employeeId: 'x', reason: 'RESIGNATION' });
      ctx.lines.rows.find((l) => l.id === 'l9x')!.advanceRecovery = 1000;
      await expect(ctx.service.approve(T, id, APPROVER)).rejects.toThrow('refresh it');
    });

    it('refuses while the final run is not posted, or a later run carries the employee', async () => {
      const ctx = setup();
      const { id } = await ctx.service.create(T, ACTOR, { employeeId: 'x', reason: 'RESIGNATION' });
      ctx.runs.rows.push({ id: 'r10', tenantId: T, runNumber: 'PR-0010', period: '2026-10', status: 'APPROVED' });
      ctx.lines.rows.push({ id: 'l10x', tenantId: T, runId: 'r10', employeeId: 'x', unpaidLeaveDays: 0, advanceRecovery: 0 });
      const later = await ctx.service.approve(T, id, APPROVER).catch((e) => e);
      expect(later).toBeInstanceOf(ConflictException);
      expect(later.message).toBe('Emp EMP-010 is on payroll for October 2026; void it first');

      ctx.runs.rows.pop();
      ctx.runs.rows[0].status = 'VOIDED';
      const err = await ctx.service.approve(T, id, APPROVER).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe("Approve payroll for September 2026 first: it is Emp EMP-010's final month");
    });

    it('refuses a net below zero (400) and a second approval (409)', async () => {
      const ctx = setup();
      ctx.advances.rows.push({ id: 'adv2', tenantId: T, employeeId: 'y', amount: 5000 });
      const y = await ctx.service.create(T, ACTOR, { employeeId: 'y', reason: 'RESIGNATION' });
      const err = await ctx.service.approve(T, y.id, APPROVER).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Emp EMP-011 owes more than the settlement pays; recover the difference outside payroll');

      const x = await ctx.service.create(T, ACTOR, { employeeId: 'x', reason: 'RESIGNATION' });
      await ctx.service.approve(T, x.id, APPROVER);
      await expect(ctx.service.approve(T, x.id, APPROVER)).rejects.toBeInstanceOf(ConflictException);
    });

    it('needs payroll:approve', async () => {
      const ctx = setup();
      const { id } = await ctx.service.create(T, ACTOR, { employeeId: 'y', reason: 'RESIGNATION' });
      await expect(ctx.service.approve(T, id, PAYER)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(ctx.service.void(T, id, PAYER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('settled employees refuse gratuity and leave adjustments', async () => {
      const ctx = setup();
      const { id } = await ctx.service.create(T, ACTOR, { employeeId: 'x', reason: 'RESIGNATION' });
      await ctx.service.approve(T, id, APPROVER);
      const g = await ctx.gratuityService.adjust(T, 'x', ACTOR, { amount: 100, note: 'x' }).catch((e) => e);
      expect(g).toBeInstanceOf(ConflictException);
      expect(g.message).toBe('Emp EMP-010 is settled');
      const l = await ctx.leaveService
        .adjust(T, 'x', ACTOR, { days: 1, note: 'x' }, [PERMISSIONS.PAYROLL_APPROVE])
        .catch((e) => e);
      expect(l).toBeInstanceOf(ConflictException);
    });
  });

  describe('void and pay', () => {
    async function approved(ctx: Ctx) {
      const { id } = await ctx.service.create(T, ACTOR, { employeeId: 'x', reason: 'RESIGNATION' });
      await ctx.service.update(T, id, { noticeDays: 10, noticeDirection: 'DEDUCT' });
      await ctx.service.approve(T, id, APPROVER);
      return id;
    }

    it('void reverses the journal exactly and restores both ledgers and the advance', async () => {
      const ctx = setup();
      const id = await approved(ctx);
      ctx.manager.query.mockClear();
      const dto = await ctx.service.void(T, id, APPROVER);
      expect(dto.status).toBe('VOIDED');
      expect(ctx.settlements.locks.at(-1)).toBe('pessimistic_write');
      expect(ctx.manager.query.mock.calls[0][0]).toContain(ADVISORY);

      const [approval, reversal] = ctx.entries.rows;
      expect(reversal).toMatchObject({
        entryNumber: `JE-${FS1}-VOID`,
        referenceType: 'SETTLEMENT',
        referenceId: id,
        totalAmount: approval.totalAmount,
      });
      const a = byRole(approval);
      const r = byRole(reversal);
      for (const k of Object.keys(a)) expect(round2(a[k] + r[k])).toBe(0);
      expect(new Date(reversal.entryDate).getTime()).toBeGreaterThanOrEqual(new Date(approval.entryDate).getTime());
      expect(ctx.settlements.rows[0].voidJournalEntryId).toBe(reversal.id);

      expect(sumOf(ctx, 'gratuity', 'x', 'amount')).toBe(12500);
      expect(sumOf(ctx, 'leaveLedger', 'x', 'amount')).toBe(3800);
      expect(sumOf(ctx, 'leaveLedger', 'x', 'days')).toBe(20);
      expect(ctx.gratuity.rows.at(-1)).toMatchObject({ kind: 'REVERSAL', amount: 12500, settlementId: id });
      expect(ctx.leaveLedger.rows.at(-1)).toMatchObject({ kind: 'REVERSAL', days: 20, amount: 3800, settlementId: id });
      expect(await ctx.advancesService.outstanding(ctx.manager, T, 'x')).toBe(3000);

      // A new settlement may now be drafted.
      const again = await ctx.service.create(T, ACTOR, { employeeId: 'x', reason: 'RESIGNATION' });
      expect(again).toMatchObject({ status: 'DRAFT', employeeId: 'x' });
    });

    it('pay posts Dr 2300 / Cr bank and moves the balance; a paid settlement cannot be voided', async () => {
      const ctx = setup();
      const id = await approved(ctx);
      const net = ctx.settlements.rows[0].netPay;
      const paidAt = new Date('2026-10-05T00:00:00Z');
      ctx.manager.query.mockClear();
      const dto = await ctx.service.pay(T, id, PAYER, { financeAccountId: BANK, paidAt });
      expect(dto).toMatchObject({ status: 'PAID', financeAccountId: BANK, paidAt: paidAt.toISOString() });
      const entry = ctx.entries.rows.at(-1);
      expect(entry).toMatchObject({ entryNumber: `JE-${FS1}-PAY`, referenceType: 'SETTLEMENT', entryDate: paidAt, totalAmount: net });
      expect(entry.lines[0]).toMatchObject({ role: LEDGER_ROLES.SALARIES_PAYABLE, debit: net, credit: 0 });
      expect(entry.lines[1]).toMatchObject({ financeAccountId: BANK, debit: 0, credit: net });
      expect(ctx.settlements.rows[0].paymentJournalEntryId).toBe(entry.id);
      const balance = ctx.manager.query.mock.calls.filter(([sql]: any) => /UPDATE "finance_accounts"/.test(sql));
      expect(balance).toHaveLength(1);
      expect(balance[0][1]).toEqual([net, BANK, T]);

      const err = await ctx.service.void(T, id, APPROVER).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe('Paid settlements cannot be voided');
      await expect(ctx.service.pay(T, id, PAYER, { financeAccountId: BANK })).rejects.toBeInstanceOf(ConflictException);
    });

    it('pay refuses a draft, a foreign-currency account and a caller without payroll:pay', async () => {
      const ctx = setup();
      const { id } = await ctx.service.create(T, ACTOR, { employeeId: 'y', reason: 'RESIGNATION' });
      await expect(ctx.service.pay(T, id, PAYER, { financeAccountId: BANK })).rejects.toBeInstanceOf(ConflictException);
      await ctx.service.approve(T, id, APPROVER);
      await expect(ctx.service.pay(T, id, PAYER, { financeAccountId: 'usd' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(ctx.service.pay(T, id, APPROVER, { financeAccountId: BANK })).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('statement carries the employee with a masked IBAN and the organization', async () => {
    const ctx = setup();
    const { id } = await ctx.service.create(T, ACTOR, { employeeId: 'x', reason: 'RESIGNATION' });
    const out = await ctx.service.statement(T, id);
    expect(out.settlement.id).toBe(id);
    expect(out.employee).toMatchObject({
      employeeNumber: 'EMP-010',
      fullName: 'Emp EMP-010',
      joiningDate: '2023-09-01',
      bankName: 'ENBD',
    });
    expect(out.employee.ibanMasked).toContain('1234');
    expect(out.employee.ibanMasked).not.toContain('cipher');
    expect(out.organization).toMatchObject({ name: 'Acme', legalName: 'Acme LLC', address: 'Dubai, AE', baseCurrency: 'AED' });
  });

  it('list returns settlements with their lines', async () => {
    const ctx = setup();
    await ctx.service.create(T, ACTOR, { employeeId: 'x', reason: 'RESIGNATION' });
    await ctx.service.create(T, ACTOR, { employeeId: 'y', reason: 'RESIGNATION' });
    const out = await ctx.service.list(T);
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.lines.length >= 2)).toBe(true);
  });
});
