import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PERMISSIONS } from '@saas/shared';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { Settlement } from './entities/settlement.entity';
import { Employee } from './entities/employee.entity';
import { SalaryPackage } from './entities/salary-package.entity';
import { PayrollRun, PayrollRunLine } from './entities/payroll-run.entity';
import { PayrollSettings } from './entities/payroll-settings.entity';
import { LeaveRecord } from './entities/leave-record.entity';
import { LeaveLedgerEntry } from './entities/leave-ledger-entry.entity';
import { EmployeesService } from './employees.service';
import { PayrollCryptoService } from './payroll-crypto.service';
import { GratuityService } from './gratuity.service';
import { PayrollSettingsService } from './payroll-settings.service';
import { LeaveService } from './leave.service';

const T = '11111111-1111-4111-8111-111111111111';
const E1 = 'e1000000-0000-4000-8000-000000000001';
const E2 = 'e2000000-0000-4000-8000-000000000002';

function repo(rows: any[]) {
  const match = (r: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => r[k] === v);
  return {
    rows,
    find: jest.fn(async ({ where }: any = {}) => rows.filter((r) => match(r, where))),
    findOne: jest.fn(async ({ where }: any = {}) => rows.find((r) => match(r, where)) ?? null),
    create: (d: any) => ({ ...d }),
    save: jest.fn(async (d: any) => {
      const list = Array.isArray(d) ? d : [d];
      list.forEach((r, i) => {
        r.id ??= `new-${rows.length + i}`;
        r.createdAt ??= new Date('2026-07-01T00:00:00Z');
      });
      rows.push(...list);
      return d;
    }),
  };
}

const emp = (id: string, over: any = {}) => ({
  id,
  tenantId: T,
  employeeNumber: `EMP-${id.slice(1, 2)}`,
  firstName: 'E',
  lastName: id.slice(0, 2),
  joiningDate: '2025-01-01',
  leavingDate: null,
  probationEndDate: null,
  annualLeaveDaysOverride: null,
  status: 'ACTIVE',
  isNational: false,
  ...over,
});

const entry = (id: string, kind: string, days: number, amount: number | null, over: any = {}) => ({
  id,
  tenantId: T,
  employeeId: E1,
  kind,
  days,
  amount,
  asOf: '2026-06-30',
  runLineId: null,
  settlementId: null,
  journalEntryId: null,
  note: null,
  createdAt: new Date('2026-07-01T00:00:00Z'),
  ...over,
});

function setup() {
  const employees = repo([
    emp(E1),
    emp(E2, { leavingDate: '2026-10-15', status: 'LEFT' }),
  ]);
  const runs = repo([]);
  const lines = repo([]);
  const records = repo([]);
  const ledgerRows = repo([]);
  const settings = repo([]);
  const packages = repo([
    { id: 'p1', tenantId: T, employeeId: E1, effectiveFrom: '2024-01-01', basic: 3000 },
  ]);
  const settlements = repo([]);
  const entries = repo([]);
  const repos = new Map<any, any>([
    [Employee, employees],
    [SalaryPackage, packages],
    [Settlement, settlements],
    [JournalEntry, entries],
    [Organization, repo([{ id: T, baseCurrency: 'AED' }])],
    [PayrollRun, runs],
    [PayrollRunLine, lines],
    [LeaveRecord, records],
    [LeaveLedgerEntry, ledgerRows],
    [PayrollSettings, settings],
  ]);
  const manager: any = { getRepository: (e: any) => repos.get(e), query: jest.fn() };
  const dataSource: any = { manager, transaction: (cb: any) => cb(manager) };
  const employeesService = new EmployeesService(dataSource, new PayrollCryptoService({} as any));
  const gratuity = new GratuityService(dataSource, {} as any, employeesService);
  const ledger: any = {
    resolveLines: jest.fn(async (_t: string, input: any[]) =>
      input.map((l) => ({ ...l, ledgerAccountId: l.role })),
    ),
  };
  const service = new LeaveService(
    dataSource,
    gratuity,
    new PayrollSettingsService(dataSource),
    ledger,
    employeesService,
  );
  return {
    service,
    manager,
    employees,
    runs,
    lines,
    records,
    ledgerRows,
    settings,
    settlements,
    entries,
    ledger,
  };
}

afterEach(() => jest.useRealTimers());

describe('LeaveService', () => {
  it('balanceDays sums days and provisionBalance sums amounts (null as 0)', async () => {
    const { service, manager, ledgerRows } = setup();
    ledgerRows.rows.push(
      entry('o', 'OPENING', 10, 1000),
      entry('a', 'ACCRUAL', 2.5, 250.25, { runLineId: 'L1' }),
      entry('t', 'TAKEN', -3, null, { runLineId: 'L1' }),
      entry('x', 'ADJUSTMENT', 1.25, null),
      entry('other', 'OPENING', 99, 9999, { employeeId: E2 }),
    );
    expect(await service.balanceDays(manager, T, E1)).toBe(10.75);
    expect(await service.provisionBalance(manager, T, E1)).toBe(1250.25);
  });

  it('accrualBaseline counts OPENING and ACCRUAL rows whose run line was not reversed', async () => {
    const { service, manager, ledgerRows } = setup();
    ledgerRows.rows.push(
      entry('o', 'OPENING', 10, 1000),
      entry('a1', 'ACCRUAL', 2.5, 250, { runLineId: 'L1' }),
      entry('t1', 'TAKEN', -3, null, { runLineId: 'L1' }),
      entry('a2', 'ACCRUAL', 2.5, 250, { runLineId: 'L2' }),
      entry('r2', 'REVERSAL', -2.5, -250, { runLineId: 'L2' }),
      entry('j', 'ADJUSTMENT', 4, null),
    );
    expect(await service.accrualBaseline(manager, T, E1)).toBe(12.5);
  });

  it('accruedTo caps service at the leaving date but counts unpaid days to asOf', async () => {
    const { service, manager, employees, runs, lines } = setup();
    // Posted October run (ends after the 15 October leaving date) with 5 unpaid days.
    runs.rows.push({ id: 'r10', tenantId: T, period: '2026-10', status: 'APPROVED', runNumber: 'PR-0001' });
    lines.rows.push({ id: 'l10', tenantId: T, runId: 'r10', employeeId: E2, unpaidLeaveDays: 5 });
    const leaver = employees.rows[1];
    const got = await service.accruedTo(manager, T, leaver, '2026-10-31');
    // 2025-01-01..2026-10-15 inclusive = 653 days, less 5 unpaid.
    expect(got.serviceDays).toBe(648);
    expect(got.annualDays).toBe(30);
    expect(got.accrued).toBe(Math.round(((30 * 648) / 365) * 100) / 100);
    const extra = await service.accruedTo(manager, T, leaver, '2026-10-31', 2);
    expect(extra.serviceDays).toBe(646);
  });

  it('accruedTo uses the employee override, else the tenant setting', async () => {
    const { service, manager, employees, settings } = setup();
    settings.rows.push({ tenantId: T, annualLeaveDays: 45 });
    const e = employees.rows[0];
    expect((await service.accruedTo(manager, T, e, '2026-06-30')).annualDays).toBe(45);
    e.annualLeaveDaysOverride = 60;
    const got = await service.accruedTo(manager, T, e, '2026-06-30');
    expect(got.annualDays).toBe(60);
    expect(got.serviceDays).toBe(546);
    expect(got.accrued).toBe(Math.round(((60 * 546) / 365) * 100) / 100);
  });

  it('periodLeave applies the records to the month', async () => {
    const { service, manager, employees, records } = setup();
    records.rows.push(
      { id: 'k1', tenantId: T, employeeId: E1, type: 'SICK', startDate: '2026-10-01', endDate: '2026-10-20', days: 20 },
      { id: 'k2', tenantId: T, employeeId: E1, type: 'UNPAID', startDate: '2026-10-25', endDate: '2026-10-26', days: 2 },
      { id: 'k3', tenantId: T, employeeId: E2, type: 'UNPAID', startDate: '2026-10-01', endDate: '2026-10-05', days: 5 },
    );
    const pl = await service.periodLeave(manager, T, employees.rows[0], '2026-10');
    expect(pl).toMatchObject({ sickFullDays: 15, halfPayDays: 5, unpaidDays: 2, leaveDays: 22 });
  });

  it('latestCutover is the latest leave OPENING asOf', async () => {
    const { service, manager, ledgerRows } = setup();
    expect(await service.latestCutover(manager, T)).toBeNull();
    ledgerRows.rows.push(
      entry('o1', 'OPENING', 1, 1, { asOf: '2026-05-31' }),
      entry('o2', 'OPENING', 1, 1, { asOf: '2026-06-30', employeeId: E2 }),
      entry('a', 'ACCRUAL', 1, 1, { asOf: '2026-09-30' }),
    );
    expect(await service.latestCutover(manager, T)).toBe('2026-06-30');
  });

  describe('summary', () => {
    function seeded() {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-16T09:00:00Z'));
      const s = setup();
      s.ledgerRows.rows.push(
        entry('o', 'OPENING', 10, 1000, { createdAt: new Date('2026-07-01') }),
        entry('a', 'ACCRUAL', 2.5, 250, { asOf: '2026-07-31', runLineId: 'L1', createdAt: new Date('2026-08-01') }),
      );
      s.records.rows.push(
        { id: 'k2', tenantId: T, employeeId: E1, type: 'ANNUAL', startDate: '2026-09-01', endDate: '2026-09-02', days: 2, note: null, createdAt: new Date('2026-08-20') },
        { id: 'k1', tenantId: T, employeeId: E1, type: 'SICK', startDate: '2026-03-01', endDate: '2026-03-01', days: 1, note: 'flu', createdAt: new Date('2026-03-02') },
      );
      return s;
    }

    it('with pay permission returns provision and amounts', async () => {
      const { service } = seeded();
      const dto = await service.summary(T, E1, true);
      expect(dto.balanceDays).toBe(12.5);
      expect(dto.provision).toBe(1250);
      expect(dto.annualDays).toBe(30);
      // 2025-01-01..2026-10-16 = 654 days.
      expect(dto.accruedToDate).toBe(Math.round(((30 * 654) / 365) * 100) / 100);
      expect(dto.entries.map((e) => [e.id, e.amount])).toEqual([['a', 250], ['o', 1000]]);
      expect(dto.records.map((r) => r.id)).toEqual(['k2', 'k1']);
      expect(dto.records[1]).toMatchObject({ type: 'SICK', days: 1, note: 'flu' });
    });

    it('without pay permission omits provision and nulls every amount', async () => {
      const { service } = seeded();
      const dto = await service.summary(T, E1, false);
      expect('provision' in dto).toBe(false);
      expect(dto.entries.every((e) => e.amount === null)).toBe(true);
      expect(dto.balanceDays).toBe(12.5);
    });

    it('404s for an unknown employee', async () => {
      const { service } = seeded();
      await expect(service.summary(T, 'nope', true)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('opening leave', () => {
    const APPROVER = [PERMISSIONS.PAYROLL_APPROVE];
    const CUT = '2026-06-30';
    // 2025-01-01..2026-06-30 = 546 days at 30 per year.
    const CALC = Math.round(((30 * 546) / 365) * 100) / 100;
    const one = (balanceDays: number) => ({
      cutoverDate: CUT,
      lines: [{ employeeId: E1, balanceDays }],
    });

    it('previews eligible employees with calculated days, defaulting to the gratuity cut-over', async () => {
      const { service } = setup();
      jest.spyOn((service as any).gratuity, 'latestCutover').mockResolvedValue(CUT);
      const out = await service.previewOpening(T);
      expect(out.cutoverDate).toBe(CUT);
      expect(out.lines).toEqual([
        {
          employeeId: E1,
          employeeName: 'E e1',
          joiningDate: '2025-01-01',
          basic: 3000,
          serviceDays: 546,
          calculatedDays: CALC,
        },
      ]);
    });

    it('defaults to the last day of last month when there is no gratuity cut-over', async () => {
      jest.useFakeTimers({ now: new Date('2026-07-15T10:00:00Z') });
      const { service } = setup();
      jest.spyOn((service as any).gratuity, 'latestCutover').mockResolvedValue(null);
      expect((await service.previewOpening(T)).cutoverDate).toBe('2026-06-30');
    });

    it('skips employees already accrued by a still-posted run, but not a voided one', async () => {
      const { service, ledgerRows } = setup();
      ledgerRows.rows.push(entry('a', 'ACCRUAL', 2, 200, { runLineId: 'L1' }));
      expect((await service.previewOpening(T, CUT)).lines).toHaveLength(0);
      ledgerRows.rows.push(entry('r', 'REVERSAL', -2, -200, { runLineId: 'L1' }));
      expect((await service.previewOpening(T, CUT)).lines).toHaveLength(1);
    });

    it('posts OPENING at calculated days, an ADJUSTMENT for the difference and one balanced journal', async () => {
      const { service, ledgerRows, entries, ledger } = setup();
      const out = await service.postOpening(T, 'actor', one(20), APPROVER);
      expect(out.total).toBe(2000);
      expect(entries.rows).toHaveLength(1);
      expect(entries.rows[0]).toMatchObject({
        referenceType: 'PAYROLL',
        referenceId: `leave-opening:${CUT}`,
        totalAmount: 2000,
        currency: 'AED',
        fxRate: 1,
      });
      expect(entries.rows[0].entryNumber).toMatch(/^JE-LEAVE-OPEN-2026-06-30-[0-9a-f]{8}$/);
      const [, input] = ledger.resolveLines.mock.calls[0];
      expect(input).toEqual([
        expect.objectContaining({ role: 'OPENING_BALANCE_EQUITY', debit: 2000 }),
        expect.objectContaining({ role: 'LEAVE_PROVISION', credit: 2000 }),
      ]);
      expect(ledgerRows.rows).toEqual([
        expect.objectContaining({ kind: 'OPENING', days: CALC, amount: 2000, asOf: CUT }),
        expect.objectContaining({
          kind: 'ADJUSTMENT',
          days: Math.round((20 - CALC) * 100) / 100,
          amount: null,
          note: 'Opening balance: leave taken before go-live',
        }),
      ]);
      expect(out.journalEntryId).toBe(entries.rows[0].id);
    });

    it('a negative balance posts the reverse journal', async () => {
      const { service, ledger } = setup();
      const out = await service.postOpening(T, 'actor', one(-3), APPROVER);
      expect(out.total).toBe(-300);
      const [, input] = ledger.resolveLines.mock.calls[0];
      expect(input).toEqual([
        expect.objectContaining({ role: 'LEAVE_PROVISION', debit: 300 }),
        expect.objectContaining({ role: 'OPENING_BALANCE_EQUITY', credit: 300 }),
      ]);
    });

    it('posts no journal when the total is zero', async () => {
      const { service, entries, ledgerRows } = setup();
      const out = await service.postOpening(T, 'actor', one(0), APPROVER);
      expect(out).toEqual({ journalEntryId: null, total: 0 });
      expect(entries.rows).toHaveLength(0);
      expect(ledgerRows.rows[0]).toMatchObject({ kind: 'OPENING', journalEntryId: null });
    });

    it('refuses a duplicate id with 400 and an existing opening with 409', async () => {
      const { service, ledgerRows } = setup();
      await expect(
        service.postOpening(
          T,
          'a',
          {
            cutoverDate: CUT,
            lines: [
              { employeeId: E1, balanceDays: 1 },
              { employeeId: E1, balanceDays: 2 },
            ],
          },
          APPROVER,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      ledgerRows.rows.push(entry('o', 'OPENING', 5, 500));
      await expect(service.postOpening(T, 'a', one(1), APPROVER)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses with 409 when a posted run already accrued leave', async () => {
      const { service, ledgerRows } = setup();
      ledgerRows.rows.push(entry('a', 'ACCRUAL', 2, 200, { runLineId: 'L1' }));
      await expect(service.postOpening(T, 'a', one(1), APPROVER)).rejects.toThrow(
        'Leave already accrued by a posted payroll run for E e1',
      );
    });

    it('refuses employees who do not qualify and actors without payroll:approve', async () => {
      const { service } = setup();
      await expect(
        service.postOpening(
          T,
          'a',
          { cutoverDate: CUT, lines: [{ employeeId: E2, balanceDays: 1 }] },
          APPROVER,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.postOpening(T, 'a', one(1), [])).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('adjust', () => {
    const APPROVER = [PERMISSIONS.PAYROLL_APPROVE];

    it('writes a days-only ADJUSTMENT with no journal', async () => {
      jest.useFakeTimers({ now: new Date('2026-08-05T10:00:00Z') });
      const { service, ledgerRows, entries } = setup();
      const dto = await service.adjust(T, E1, 'a', { days: -1.5, note: 'Carried over' }, APPROVER);
      expect(dto).toMatchObject({
        kind: 'ADJUSTMENT',
        days: -1.5,
        amount: null,
        asOf: '2026-08-05',
        note: 'Carried over',
      });
      expect(ledgerRows.rows[0]).toMatchObject({ amount: null, journalEntryId: null });
      expect(entries.rows).toHaveLength(0);
    });

    it('refuses a settled employee, an unknown one and a missing permission', async () => {
      const { service, settlements } = setup();
      settlements.rows.push({ id: 's', tenantId: T, employeeId: E1, status: 'APPROVED' });
      await expect(
        service.adjust(T, E1, 'a', { days: 1, note: 'x' }, APPROVER),
      ).rejects.toThrow('E e1 is settled');
      await expect(
        service.adjust(T, 'nope', 'a', { days: 1, note: 'x' }, APPROVER),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.adjust(T, E1, 'a', { days: 1, note: 'x' }, [])).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
