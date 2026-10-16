import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Employee } from './entities/employee.entity';
import { SalaryPackage } from './entities/salary-package.entity';
import { EmployeeAdvance } from './entities/employee-advance.entity';
import { PayrollRun, PayrollRunLine } from './entities/payroll-run.entity';
import { GratuityLedgerEntry } from './entities/gratuity-ledger-entry.entity';
import { PayrollSettings } from './entities/payroll-settings.entity';
import { LeaveRecord } from './entities/leave-record.entity';
import { LeaveLedgerEntry } from './entities/leave-ledger-entry.entity';
import { Settlement } from './entities/settlement.entity';
import { EmployeesService } from './employees.service';
import { PayrollCryptoService } from './payroll-crypto.service';
import { AdvancesService } from './advances.service';
import { GratuityService } from './gratuity.service';
import { PayrollSettingsService } from './payroll-settings.service';
import { PayrollRunsService } from './payroll-runs.service';
import { LeaveService } from './leave.service';
import { LeaveRecordsService } from './leave-records.service';

const T = '11111111-1111-4111-8111-111111111111';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const A = 'a0000000-0000-4000-8000-00000000000a';
const B = 'b0000000-0000-4000-8000-00000000000b';

function repo(rows: any[], events: string[] = []) {
  let n = 0;
  const match = (r: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => r[k] === v);
  return {
    rows,
    create: (d: any) => ({ ...d }),
    find: jest.fn(async ({ where }: any = {}) => rows.filter((r) => match(r, where))),
    findOne: jest.fn(async ({ where }: any = {}) => {
      const r = rows.find((x) => match(x, where));
      return r ? { ...r } : null;
    }),
    save: jest.fn(async (e: any) => {
      const list = Array.isArray(e) ? e : [e];
      const out = list.map((x: any) => {
        if (!x.id) x.id = `id-${++n}`;
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
      for (const r of rows.filter((x) => match(x, where))) Object.assign(r, patch);
      return { affected: 1 };
    }),
    delete: jest.fn(async (where: any) => {
      const gone = rows.filter((x) => match(x, where));
      for (const x of gone) rows.splice(rows.indexOf(x), 1);
      return { affected: gone.length };
    }),
    createQueryBuilder: jest.fn(() => {
      const params: any = {};
      const qb: any = {
        setLock: jest.fn(() => qb),
        where: jest.fn((_s: string, p: any) => (Object.assign(params, p), qb)),
        andWhere: jest.fn((_s: string, p: any) => (Object.assign(params, p), qb)),
        getOne: jest.fn(async () => {
          const r = rows.find((x) => x.id === params.id && x.tenantId === params.tenantId);
          if (r) events.push(`lock:${r.id}`);
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
  joiningDate: '2024-01-01',
  leavingDate: null,
  probationEndDate: null,
  annualLeaveDaysOverride: null,
  status: 'ACTIVE',
  isNational: false,
  paymentMethod: 'BANK',
  ...over,
});

const pkg = (id: string, employeeId: string, basic: number, housing: number, transport: number) => ({
  id,
  tenantId: T,
  employeeId,
  effectiveFrom: '2024-01-01',
  basic,
  housing,
  transport,
  otherAllowances: [],
});

const rec = (id: string, type: string, startDate: string, endDate: string, days: number, over: any = {}) => ({
  id,
  tenantId: T,
  employeeId: A,
  type,
  startDate,
  endDate,
  days,
  note: null,
  createdById: ACTOR,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  ...over,
});

function setup() {
  const events: string[] = [];
  const employees = repo([
    emp(A, 'EMP-001'),
    emp(B, 'EMP-002', { leavingDate: '2026-12-31' }),
  ]);
  const packages = repo([pkg('pa', A, 6000, 2000, 1000), pkg('pb', B, 3000, 0, 0)]);
  const runs = repo([], events);
  const lines = repo([]);
  const records = repo([]);
  const settlements = repo([]);
  const repos = new Map<any, any>([
    [Employee, employees],
    [SalaryPackage, packages],
    [EmployeeAdvance, repo([])],
    [PayrollRun, runs],
    [PayrollRunLine, lines],
    [GratuityLedgerEntry, repo([])],
    [PayrollSettings, repo([])],
    [LeaveRecord, records],
    [LeaveLedgerEntry, repo([])],
    [Settlement, settlements],
  ]);
  let seq = 0;
  const manager: any = {
    getRepository: (e: any) => repos.get(e),
    query: jest.fn(async (sql: string) => {
      if (sql.includes('pg_advisory_xact_lock')) events.push('advisory');
      return [{ current_value: ++seq }];
    }),
  };
  const dataSource: any = { manager, transaction: (cb: any) => cb(manager) };
  const ledger: any = {};
  const employeesService = new EmployeesService(dataSource, new PayrollCryptoService({}));
  const gratuity = new GratuityService(dataSource, ledger, employeesService);
  const leave = new LeaveService(dataSource, gratuity, new PayrollSettingsService(dataSource));
  const runsService = new PayrollRunsService(
    dataSource,
    employeesService,
    new AdvancesService(dataSource, ledger),
    gratuity,
    leave,
  );
  const service = new LeaveRecordsService(dataSource, leave, runsService);
  return { service, runsService, events, employees, runs, lines, records, settlements };
}

const input = (type: string, startDate: string, endDate: string, days?: number): any => ({
  type,
  startDate,
  endDate,
  days: days ?? Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1,
  note: null,
});

const lineFor = (lines: any, employeeId: string) =>
  lines.rows.find((l: any) => l.employeeId === employeeId);

describe('LeaveRecordsService', () => {
  it('creates a record and returns it', async () => {
    const { service, records } = setup();
    const dto = await service.create(T, A, ACTOR, { ...input('ANNUAL', '2026-10-05', '2026-10-08'), note: 'Trip' });
    expect(dto).toMatchObject({
      employeeId: A,
      type: 'ANNUAL',
      startDate: '2026-10-05',
      endDate: '2026-10-08',
      days: 4,
      note: 'Trip',
    });
    expect(typeof dto.createdAt).toBe('string');
    expect(records.rows).toHaveLength(1);
    expect(records.rows[0]).toMatchObject({ tenantId: T, createdById: ACTOR });
  });

  it('404s for an unknown employee', async () => {
    const { service } = setup();
    await expect(
      service.create(T, 'c0000000-0000-4000-8000-00000000000c', ACTOR, input('ANNUAL', '2026-10-05', '2026-10-08')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses an overlap with another record of the employee', async () => {
    const { service, records } = setup();
    records.rows.push(rec('k1', 'ANNUAL', '2026-10-05', '2026-10-08', 4));
    records.rows.push(rec('kb', 'ANNUAL', '2026-10-01', '2026-10-31', 31, { employeeId: B }));
    const err = await service
      .create(T, A, ACTOR, input('SICK', '2026-10-08', '2026-10-09'))
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe('Emp EMP-001 already has annual leave from 2026-10-05 to 2026-10-08');
    // Moving a record within its own range is not an overlap with itself.
    await expect(
      service.update(T, A, 'k1', input('ANNUAL', '2026-10-06', '2026-10-09')),
    ).resolves.toMatchObject({ startDate: '2026-10-06', endDate: '2026-10-09' });
  });

  it('refuses a record in a month with a posted run that has a line for the employee', async () => {
    const { service, runs, lines } = setup();
    runs.rows.push({ id: 'r9', tenantId: T, period: '2026-09', status: 'APPROVED', runNumber: 'PR-0007' });
    lines.rows.push({ id: 'l9', tenantId: T, runId: 'r9', employeeId: A, unpaidLeaveDays: 0 });
    const err = await service
      .create(T, A, ACTOR, input('ANNUAL', '2026-09-28', '2026-10-02'))
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe(
      'Payroll PR-0007 for September 2026 is already posted; void it to change leave in that month',
    );
  });

  it('allows a record in a posted month when the posted run has no line for the employee', async () => {
    const { service, runs, lines } = setup();
    runs.rows.push({ id: 'r9', tenantId: T, period: '2026-09', status: 'PAID', runNumber: 'PR-0007' });
    lines.rows.push({ id: 'l9', tenantId: T, runId: 'r9', employeeId: B, unpaidLeaveDays: 0 });
    await expect(
      service.create(T, A, ACTOR, input('ANNUAL', '2026-09-28', '2026-10-02')),
    ).resolves.toMatchObject({ startDate: '2026-09-28' });
  });

  it('refuses to edit or delete a record that sits in a posted month', async () => {
    const { service, runs, lines, records } = setup();
    runs.rows.push({ id: 'r9', tenantId: T, period: '2026-09', status: 'APPROVED', runNumber: 'PR-0007' });
    lines.rows.push({ id: 'l9', tenantId: T, runId: 'r9', employeeId: A, unpaidLeaveDays: 0 });
    records.rows.push(rec('k1', 'ANNUAL', '2026-09-10', '2026-09-11', 2));
    // Moving it out of September still touches September.
    await expect(
      service.update(T, A, 'k1', input('ANNUAL', '2026-10-10', '2026-10-11')),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(service.remove(T, A, 'k1')).rejects.toBeInstanceOf(ConflictException);
    expect(records.rows).toHaveLength(1);
  });

  it('refuses any change once the employee is settled', async () => {
    const { service, settlements } = setup();
    settlements.rows.push({ id: 's1', tenantId: T, employeeId: A, status: 'VOIDED' });
    await expect(
      service.create(T, A, ACTOR, input('ANNUAL', '2026-10-05', '2026-10-06')),
    ).resolves.toBeDefined();
    settlements.rows.push({ id: 's2', tenantId: T, employeeId: A, status: 'APPROVED' });
    const err = await service
      .create(T, A, ACTOR, input('ANNUAL', '2026-10-15', '2026-10-16'))
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe('Emp EMP-001 is settled; leave can no longer change');
  });

  it('refuses the 91st sick day of a service year', async () => {
    const { service, records } = setup();
    // 1 March .. 29 May 2026 = 90 days, all in the service year from 1 January 2026.
    records.rows.push(rec('k1', 'SICK', '2026-03-01', '2026-05-29', 90));
    const err = await service
      .create(T, A, ACTOR, input('SICK', '2026-07-01', '2026-07-01'))
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe(
      'More than 90 sick days in one service year; record the employee as having left instead',
    );
    // The next service year starts afresh.
    await expect(
      service.create(T, A, ACTOR, input('SICK', '2027-01-05', '2027-01-05')),
    ).resolves.toBeDefined();
  });

  it('refuses dates before joining or after leaving', async () => {
    const { service } = setup();
    await expect(
      service.create(T, A, ACTOR, input('ANNUAL', '2023-12-31', '2024-01-02')),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(T, B, ACTOR, input('ANNUAL', '2026-12-30', '2027-01-02')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s when the record does not belong to the employee', async () => {
    const { service, records } = setup();
    records.rows.push(rec('kb', 'ANNUAL', '2026-10-01', '2026-10-02', 2, { employeeId: B }));
    await expect(service.remove(T, A, 'kb')).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.update(T, A, 'kb', input('ANNUAL', '2026-10-01', '2026-10-02')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('draft refill', () => {
    async function withDraft() {
      const s = setup();
      const run = await s.runsService.create(T, ACTOR, { period: '2026-10' } as any);
      s.events.length = 0;
      return { ...s, runId: run.id, before: run };
    }

    it('refills the draft line when a leave record changes', async () => {
      const { service, runs, lines, runId, before, events } = await withDraft();
      const line0 = lineFor(lines, A);
      expect(line0.unpaidLeaveDays).toBe(0);
      const net0 = before.totals.net;

      // 20 sick days: 15 full pay, 5 half pay; and 2 unpaid days.
      await service.create(T, A, ACTOR, input('SICK', '2026-10-01', '2026-10-20'));
      const created = await service.create(T, A, ACTOR, input('UNPAID', '2026-10-25', '2026-10-26'));

      const line = lineFor(lines, A);
      // gross 9000 → daily 300.
      expect(line).toMatchObject({
        unpaidLeaveDays: 2,
        halfPayDays: 5,
        leaveDaysInPeriod: 22,
        annualLeaveDays: 0,
        unpaidLeaveAmount: 600,
        halfPayAmount: 750,
      });
      const run = runs.rows.find((r: any) => r.id === runId);
      expect(run.totalHalfPay).toBe(750);
      expect(run.totalUnpaidLeave).toBe(600);
      expect(run.totalNet).toBe(Math.round((net0 - 1350) * 100) / 100);
      // The other employee's line is untouched.
      expect(lineFor(lines, B).unpaidLeaveDays).toBe(0);
      // Draft run locked before the tenant's advisory lock.
      expect(events.indexOf(`lock:${runId}`)).toBeGreaterThanOrEqual(0);
      expect(events.indexOf(`lock:${runId}`)).toBeLessThan(events.indexOf('advisory'));

      // Edit: the unpaid days become annual leave.
      await service.update(T, A, created.id, input('ANNUAL', '2026-10-25', '2026-10-26'));
      expect(lineFor(lines, A)).toMatchObject({ unpaidLeaveDays: 0, annualLeaveDays: 2, leaveDaysInPeriod: 22 });
      expect(runs.rows.find((r: any) => r.id === runId).totalUnpaidLeave).toBe(0);
    });

    it('an overridden line keeps its manual values but its leave days update', async () => {
      const { service, lines } = await withDraft();
      Object.assign(lineFor(lines, A), { leaveOverridden: true, unpaidLeaveDays: 1, halfPayDays: 0 });
      await service.create(T, A, ACTOR, input('SICK', '2026-10-01', '2026-10-20'));
      expect(lineFor(lines, A)).toMatchObject({
        leaveOverridden: true,
        unpaidLeaveDays: 1,
        halfPayDays: 0,
        leaveDaysInPeriod: 20,
      });
    });

    it('delete refills too', async () => {
      const { service, runs, lines, runId, before } = await withDraft();
      const dto = await service.create(T, A, ACTOR, input('UNPAID', '2026-10-01', '2026-10-03'));
      expect(lineFor(lines, A).unpaidLeaveDays).toBe(3);
      await service.remove(T, A, dto.id);
      expect(lineFor(lines, A)).toMatchObject({ unpaidLeaveDays: 0, unpaidLeaveAmount: 0, leaveDaysInPeriod: 0 });
      expect(runs.rows.find((r: any) => r.id === runId).totalNet).toBe(before.totals.net);
    });

    it('leaves non-draft runs alone', async () => {
      const { service, runs, lines, runId } = await withDraft();
      runs.rows.find((r: any) => r.id === runId).status = 'VOIDED';
      await service.create(T, A, ACTOR, input('UNPAID', '2026-10-01', '2026-10-03'));
      expect(lineFor(lines, A).unpaidLeaveDays).toBe(0);
    });
  });
});
