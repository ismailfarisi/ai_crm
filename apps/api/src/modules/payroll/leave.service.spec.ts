import { NotFoundException } from '@nestjs/common';
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
  const repos = new Map<any, any>([
    [Employee, employees],
    [SalaryPackage, repo([])],
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
  const service = new LeaveService(dataSource, gratuity, new PayrollSettingsService(dataSource));
  return { service, manager, employees, runs, lines, records, ledgerRows, settings };
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
});
