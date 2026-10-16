import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { gratuityEntitlement, LEDGER_ROLES } from '@saas/shared';
import { Organization } from '../organizations/entities/organization.entity';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { Employee } from './entities/employee.entity';
import { SalaryPackage } from './entities/salary-package.entity';
import { PayrollRun, PayrollRunLine } from './entities/payroll-run.entity';
import { GratuityLedgerEntry } from './entities/gratuity-ledger-entry.entity';
import { EmployeesService } from './employees.service';
import { PayrollCryptoService } from './payroll-crypto.service';
import { GratuityService } from './gratuity.service';

const T = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const E1 = 'e1000000-0000-4000-8000-000000000001';
const E2 = 'e2000000-0000-4000-8000-000000000002';
const E3 = 'e3000000-0000-4000-8000-000000000003';
const E4 = 'e4000000-0000-4000-8000-000000000004';
const E6 = 'e6000000-0000-4000-8000-000000000006';

function repo(rows: any[]) {
  let n = 0;
  const match = (r: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => r[k] === v);
  return {
    rows,
    create: (d: any) => ({ ...d }),
    find: jest.fn(async ({ where }: any = {}) => rows.filter((r) => match(r, where))),
    findOne: jest.fn(async ({ where }: any = {}) => rows.find((r) => match(r, where)) ?? null),
    save: jest.fn(async (e: any) => {
      const list = Array.isArray(e) ? e : [e];
      for (const x of list) {
        if (!x.id) x.id = `id-${++n}`;
        if (!rows.includes(x)) {
          x.createdAt ??= new Date();
          rows.push(x);
        }
      }
      return e;
    }),
  };
}

const emp = (id: string, over: any = {}) => ({
  id,
  tenantId: T,
  employeeNumber: `EMP-${id.slice(1, 2)}`,
  firstName: 'E',
  lastName: id.slice(0, 2),
  joiningDate: '2023-10-01',
  leavingDate: null,
  status: 'ACTIVE',
  isNational: false,
  ...over,
});

function setup() {
  const employees = repo([
    emp(E1),
    emp(E2, { joiningDate: '2026-10-01' }),
    emp(E3, { status: 'LEFT', leavingDate: '2026-05-31' }),
    emp(E4),
    emp(E6, { joiningDate: '2025-01-01' }),
  ]);
  const packages = repo([
    { id: 'p1', tenantId: T, employeeId: E1, effectiveFrom: '2023-10-01', basic: 6000, housing: 0, transport: 0, otherAllowances: [] },
    { id: 'p6', tenantId: T, employeeId: E6, effectiveFrom: '2025-01-01', basic: 3000, housing: 0, transport: 0, otherAllowances: [] },
  ]);
  const runs = repo([]);
  const lines = repo([]);
  const ledgerRows = repo([
    { id: 'g4', tenantId: T, employeeId: E4, kind: 'OPENING', amount: 800, asOf: '2026-06-30', runLineId: null, journalEntryId: 'je0', note: null, createdAt: new Date() },
  ]);
  const entries = repo([]);
  const orgs = repo([{ id: T, baseCurrency: 'AED' }]);
  const repos = new Map<any, any>([
    [Employee, employees],
    [SalaryPackage, packages],
    [PayrollRun, runs],
    [PayrollRunLine, lines],
    [GratuityLedgerEntry, ledgerRows],
    [JournalEntry, entries],
    [Organization, orgs],
  ]);
  const manager: any = {
    getRepository: (e: any) => repos.get(e),
    query: jest.fn(async () => []),
  };
  const dataSource: any = { manager, transaction: (cb: any) => cb(manager) };
  const ledger: any = {
    resolveLines: jest.fn(async (_t: string, input: any[]) =>
      input.map((l) => ({ ...l, ledgerAccountId: l.role })),
    ),
  };
  const employeesService = new EmployeesService(dataSource, new PayrollCryptoService({} as any));
  const service = new GratuityService(dataSource, ledger, employeesService);
  return { service, manager, ledger, employees, runs, lines, ledgerRows, entries };
}

afterEach(() => jest.useRealTimers());

describe('GratuityService', () => {
  describe('unpaidLeaveDaysTo', () => {
    it('sums approved or paid runs ending on or before asOf, plus extra days', async () => {
      const { service, manager, runs, lines } = setup();
      runs.rows.push(
        { id: 'r8', tenantId: T, period: '2026-08', status: 'APPROVED' },
        { id: 'r7', tenantId: T, period: '2026-07', status: 'PAID' },
        { id: 'r5', tenantId: T, period: '2026-05', status: 'PARTIALLY_PAID' },
        { id: 'r9', tenantId: T, period: '2026-09', status: 'DRAFT' },
        { id: 'r6', tenantId: T, period: '2026-06', status: 'VOIDED' },
        { id: 'r10', tenantId: T, period: '2026-10', status: 'APPROVED' },
      );
      lines.rows.push(
        { id: 'l8', tenantId: T, runId: 'r8', employeeId: E1, unpaidLeaveDays: 2 },
        { id: 'l7', tenantId: T, runId: 'r7', employeeId: E1, unpaidLeaveDays: 1.5 },
        { id: 'l5', tenantId: T, runId: 'r5', employeeId: E1, unpaidLeaveDays: 0.5 },
        { id: 'l9', tenantId: T, runId: 'r9', employeeId: E1, unpaidLeaveDays: 3 },
        { id: 'l6', tenantId: T, runId: 'r6', employeeId: E1, unpaidLeaveDays: 4 },
        { id: 'l10', tenantId: T, runId: 'r10', employeeId: E1, unpaidLeaveDays: 5 },
        { id: 'lx', tenantId: T, runId: 'r8', employeeId: E6, unpaidLeaveDays: 9 },
      );
      expect(await service.unpaidLeaveDaysTo(manager, T, E1, '2026-09-30')).toBe(4);
      expect(await service.unpaidLeaveDaysTo(manager, T, E1, '2026-09-30', 1)).toBe(5);
      expect(await service.unpaidLeaveDaysTo(manager, T, E1, '2026-08-30')).toBe(2);
    });
  });

  describe('entitlement', () => {
    it('uses the package in force at asOf and subtracts unpaid leave', async () => {
      const { service, manager, employees } = setup();
      const e1 = employees.rows[0];
      const got = await service.entitlement(manager, T, e1, '2026-09-30', 10);
      const want = gratuityEntitlement({
        joiningDate: '2023-10-01', asOf: '2026-09-30', basic: 6000, unpaidLeaveDays: 10, isNational: false,
      });
      expect(got).toEqual({ serviceDays: want.serviceDays, amount: want.amount, basic: 6000 });
    });

    it('a leaver: service stops at the leaving date, but the final month’s unpaid leave still counts', async () => {
      const { service, manager, employees, runs, lines } = setup();
      const leaver = { ...employees.rows[0], status: 'LEFT', leavingDate: '2026-05-15' };
      runs.rows.push({ id: 'r5', tenantId: T, period: '2026-05', status: 'APPROVED' });
      lines.rows.push({ id: 'l5', tenantId: T, runId: 'r5', employeeId: E1, unpaidLeaveDays: 3 });
      const got = await service.entitlement(manager, T, leaver, '2026-05-31', 2);
      const want = gratuityEntitlement({
        joiningDate: '2023-10-01', asOf: '2026-05-15', basic: 6000, unpaidLeaveDays: 5, isNational: false,
      });
      expect(got.serviceDays).toBe(want.serviceDays);
      expect(got.amount).toBe(want.amount);
    });

    it('is zero without a package', async () => {
      const { service, manager, employees } = setup();
      const got = await service.entitlement(manager, T, employees.rows[2], '2026-09-30');
      expect(got.amount).toBe(0);
      expect(got.basic).toBe(0);
    });
  });

  describe('previewOpening', () => {
    it('defaults to the last day of last month and lists eligible employees only', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-16T09:00:00Z'));
      const { service } = setup();
      const dto = await service.previewOpening(T);
      expect(dto.cutoverDate).toBe('2026-09-30');
      expect(dto.lines.map((l) => l.employeeId).sort()).toEqual([E1, E6].sort());
      const l1 = dto.lines.find((l) => l.employeeId === E1)!;
      const want = gratuityEntitlement({
        joiningDate: '2023-10-01', asOf: '2026-09-30', basic: 6000, unpaidLeaveDays: 0, isNational: false,
      });
      expect(l1).toEqual(
        expect.objectContaining({ basic: 6000, serviceDays: want.serviceDays, calculated: want.amount, joiningDate: '2023-10-01' }),
      );
    });

    it('defaults to the month before the earliest non-voided run', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-16T09:00:00Z'));
      const { service, runs } = setup();
      runs.rows.push(
        { id: 'rv', tenantId: T, period: '2026-03', status: 'VOIDED' },
        { id: 'r8', tenantId: T, period: '2026-08', status: 'DRAFT' },
        { id: 'r9', tenantId: T, period: '2026-09', status: 'APPROVED' },
      );
      const dto = await service.previewOpening(T);
      expect(dto.cutoverDate).toBe('2026-07-31');
    });

    it('honours an explicit cutover', async () => {
      const { service } = setup();
      const dto = await service.previewOpening(T, '2024-12-31');
      expect(dto.lines.map((l) => l.employeeId)).toEqual([E1]);
    });
  });

  describe('postOpening', () => {
    it('posts one entry for the total and one OPENING row per line', async () => {
      const { service, manager, ledger, entries, ledgerRows } = setup();
      const res = await service.postOpening(T, ACTOR, {
        cutoverDate: '2026-09-30',
        lines: [
          { employeeId: E1, amount: 10000 },
          { employeeId: E6, amount: 0 },
        ],
      });
      expect(res.total).toBe(10000);
      expect(entries.rows).toHaveLength(1);
      const entry = entries.rows[0];
      expect(res.journalEntryId).toBe(entry.id);
      expect(entry.referenceType).toBe('PAYROLL');
      expect(entry.referenceId).toBe('gratuity-opening:2026-09-30');
      expect(entry.entryDate.toISOString().slice(0, 10)).toBe('2026-09-30');
      expect(entry.totalAmount).toBe(10000);

      const [, input] = ledger.resolveLines.mock.calls[0];
      expect(input).toEqual([
        expect.objectContaining({ role: LEDGER_ROLES.OPENING_BALANCE_EQUITY, debit: 10000, credit: 0 }),
        expect.objectContaining({ role: LEDGER_ROLES.GRATUITY_PROVISION, debit: 0, credit: 10000 }),
      ]);

      // OPENING is the statutory amount; the override is an ADJUSTMENT, and
      // each employee's rows sum to what was posted.
      const calc1 = gratuityEntitlement({ joiningDate: '2023-10-01', asOf: '2026-09-30', basic: 6000, unpaidLeaveDays: 0, isNational: false }).amount;
      const calc6 = gratuityEntitlement({ joiningDate: '2025-01-01', asOf: '2026-09-30', basic: 3000, unpaidLeaveDays: 0, isNational: false }).amount;
      const mine = ledgerRows.rows.filter((r) => r.employeeId !== E4);
      expect(mine.filter((r) => r.kind === 'OPENING')).toHaveLength(2);
      expect(mine.find((r) => r.employeeId === E1 && r.kind === 'OPENING')).toEqual(
        expect.objectContaining({ amount: calc1, asOf: '2026-09-30', journalEntryId: entry.id }),
      );
      expect(mine.find((r) => r.employeeId === E1 && r.kind === 'ADJUSTMENT')).toEqual(
        expect.objectContaining({ amount: Math.round((10000 - calc1) * 100) / 100, asOf: '2026-09-30', note: 'Opening override', journalEntryId: entry.id }),
      );
      expect(mine.find((r) => r.employeeId === E6 && r.kind === 'OPENING')).toEqual(
        expect.objectContaining({ amount: calc6, asOf: '2026-09-30' }),
      );
      expect(mine.find((r) => r.employeeId === E6 && r.kind === 'ADJUSTMENT')!.amount).toBe(-calc6);
      expect(await service.balance(manager, T, E1)).toBe(10000);
      expect(await service.balance(manager, T, E6)).toBe(0);
    });

    it('writes no ADJUSTMENT when the posted amount is the calculated one', async () => {
      const { service, ledgerRows } = setup();
      const { lines } = await service.previewOpening(T, '2026-09-30');
      await service.postOpening(T, ACTOR, {
        cutoverDate: '2026-09-30',
        lines: lines.map((l) => ({ employeeId: l.employeeId, amount: l.calculated })),
      });
      expect(ledgerRows.rows.some((r) => r.kind === 'ADJUSTMENT')).toBe(false);
    });

    it('excludes from the preview, and refuses (409, naming them), employees already accrued by a posted run', async () => {
      const { service, ledgerRows } = setup();
      ledgerRows.rows.push(
        { id: 'a1', tenantId: T, employeeId: E1, kind: 'ACCRUAL', amount: 500, asOf: '2026-10-31', runLineId: 'l1', journalEntryId: 'je', note: null, createdAt: new Date() },
        // E6's accrual was voided: it no longer counts.
        { id: 'a6', tenantId: T, employeeId: E6, kind: 'ACCRUAL', amount: 90, asOf: '2026-10-31', runLineId: 'l6', journalEntryId: 'je', note: null, createdAt: new Date() },
        { id: 'v6', tenantId: T, employeeId: E6, kind: 'REVERSAL', amount: -90, asOf: '2026-10-31', runLineId: 'l6', journalEntryId: 'jv', note: null, createdAt: new Date() },
      );
      const dto = await service.previewOpening(T, '2026-11-30');
      expect(dto.lines.map((l) => l.employeeId)).toEqual([E2, E6]);
      await expect(
        service.postOpening(T, ACTOR, {
          cutoverDate: '2026-11-30',
          lines: [{ employeeId: E1, amount: 100 }, { employeeId: E6, amount: 0 }],
        }),
      ).rejects.toThrow(new ConflictException('Gratuity already accrued by a posted payroll run for E e1'));
      expect(ledgerRows.rows.filter((r) => r.kind === 'OPENING' && r.employeeId !== E4)).toHaveLength(0);
      await service.postOpening(T, ACTOR, { cutoverDate: '2026-11-30', lines: [{ employeeId: E6, amount: 0 }] });
    });

    it('refuses a second opening for the same employee', async () => {
      const { service } = setup();
      await service.postOpening(T, ACTOR, { cutoverDate: '2026-09-30', lines: [{ employeeId: E1, amount: 100 }] });
      await expect(
        service.postOpening(T, ACTOR, { cutoverDate: '2026-09-30', lines: [{ employeeId: E1, amount: 100 }] }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses employees that do not qualify', async () => {
      const { service } = setup();
      for (const id of [E2, E3]) {
        await expect(
          service.postOpening(T, ACTOR, { cutoverDate: '2026-09-30', lines: [{ employeeId: id, amount: 100 }] }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      await expect(
        service.postOpening(OTHER, ACTOR, { cutoverDate: '2026-09-30', lines: [{ employeeId: E1, amount: 100 }] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses when an approved run ends on or before the cutover', async () => {
      const { service, runs } = setup();
      runs.rows.push({ id: 'r9', tenantId: T, period: '2026-09', status: 'PAID' });
      await expect(
        service.postOpening(T, ACTOR, { cutoverDate: '2026-09-30', lines: [{ employeeId: E1, amount: 100 }] }),
      ).rejects.toThrow(new ConflictException('Runs already posted for or before the cut-over'));
    });

    it('records the cutover as the latest OPENING asOf', async () => {
      const { service, manager } = setup();
      expect(await service.latestCutover(manager, T)).toBe('2026-06-30');
      await service.postOpening(T, ACTOR, { cutoverDate: '2026-09-30', lines: [{ employeeId: E1, amount: 1 }] });
      expect(await service.latestCutover(manager, T)).toBe('2026-09-30');
      expect(await service.latestCutover(manager, OTHER)).toBeNull();
    });
  });

  describe('adjust', () => {
    it('positive credits the provision', async () => {
      const { service, ledger, ledgerRows } = setup();
      const dto = await service.adjust(T, E1, ACTOR, { amount: 500, note: 'Missed month' });
      expect(dto.kind).toBe('ADJUSTMENT');
      expect(dto.amount).toBe(500);
      const [, input] = ledger.resolveLines.mock.calls[0];
      expect(input).toEqual([
        expect.objectContaining({ role: LEDGER_ROLES.OPENING_BALANCE_EQUITY, debit: 500, credit: 0 }),
        expect.objectContaining({ role: LEDGER_ROLES.GRATUITY_PROVISION, debit: 0, credit: 500 }),
      ]);
      expect(ledgerRows.rows.at(-1)).toEqual(expect.objectContaining({ employeeId: E1, kind: 'ADJUSTMENT', amount: 500, note: 'Missed month' }));
    });

    it('negative posts the reversed sides', async () => {
      const { service, ledger, ledgerRows, entries } = setup();
      await service.adjust(T, E1, ACTOR, { amount: -300, note: 'Overstated' });
      const [, input] = ledger.resolveLines.mock.calls[0];
      expect(input).toEqual([
        expect.objectContaining({ role: LEDGER_ROLES.GRATUITY_PROVISION, debit: 300, credit: 0 }),
        expect.objectContaining({ role: LEDGER_ROLES.OPENING_BALANCE_EQUITY, debit: 0, credit: 300 }),
      ]);
      const row = ledgerRows.rows.at(-1);
      expect(row.amount).toBe(-300);
      expect(row.journalEntryId).toBe(entries.rows[0].id);
      expect(entries.rows[0].totalAmount).toBe(300);
    });

    it('refuses an employee of another tenant', async () => {
      const { service } = setup();
      await expect(service.adjust(OTHER, E1, ACTOR, { amount: 1, note: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('balance and summary', () => {
    it('balance sums the ledger; summary adds today’s entitlement', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-16T09:00:00Z'));
      const { service, manager, ledgerRows } = setup();
      ledgerRows.rows.push(
        { id: 'g1', tenantId: T, employeeId: E1, kind: 'OPENING', amount: 1000, asOf: '2026-06-30', runLineId: null, journalEntryId: null, note: null, createdAt: new Date('2026-07-01') },
        { id: 'g2', tenantId: T, employeeId: E1, kind: 'ACCRUAL', amount: 350.5, asOf: '2026-07-31', runLineId: 'l', journalEntryId: null, note: null, createdAt: new Date('2026-08-01') },
      );
      expect(await service.balance(manager, T, E1)).toBe(1350.5);
      const dto = await service.summary(T, E1);
      expect(dto.balance).toBe(1350.5);
      expect(dto.entries.map((e) => e.id)).toEqual(['g2', 'g1']);
      const want = gratuityEntitlement({
        joiningDate: '2023-10-01', asOf: '2026-10-16', basic: 6000, unpaidLeaveDays: 0, isNational: false,
      });
      expect(dto.entitlementToday).toBe(want.amount);
      expect(dto.serviceDaysToday).toBe(want.serviceDays);
    });

    it('entitlementToday is the true-up target: statutory + Σ adjustments', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-16T09:00:00Z'));
      const { service, ledgerRows } = setup();
      ledgerRows.rows.push(
        { id: 'j1', tenantId: T, employeeId: E1, kind: 'ADJUSTMENT', amount: 1000, asOf: '2026-08-01', runLineId: null, journalEntryId: null, note: 'Contract', createdAt: new Date() },
        { id: 'j2', tenantId: T, employeeId: E1, kind: 'ADJUSTMENT', amount: -250, asOf: '2026-09-01', runLineId: null, journalEntryId: null, note: 'Fix', createdAt: new Date() },
      );
      const dto = await service.summary(T, E1);
      const want = gratuityEntitlement({
        joiningDate: '2023-10-01', asOf: '2026-10-16', basic: 6000, unpaidLeaveDays: 0, isNational: false,
      }).amount;
      expect(dto.statutoryEntitlementToday).toBe(want);
      expect(dto.entitlementToday).toBe(Math.round((want + 750) * 100) / 100);
    });
  });
});
