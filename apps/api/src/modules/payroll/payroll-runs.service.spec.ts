import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Organization } from '../organizations/entities/organization.entity';
import { Employee } from './entities/employee.entity';
import { SalaryPackage } from './entities/salary-package.entity';
import { EmployeeAdvance } from './entities/employee-advance.entity';
import { PayrollRun, PayrollRunLine } from './entities/payroll-run.entity';
import { GratuityLedgerEntry } from './entities/gratuity-ledger-entry.entity';
import { LeaveLedgerEntry } from './entities/leave-ledger-entry.entity';
import { EmployeesService } from './employees.service';
import { PayrollCryptoService } from './payroll-crypto.service';
import { AdvancesService } from './advances.service';
import { GratuityService } from './gratuity.service';
import { PayrollSettingsService } from './payroll-settings.service';
import { LeaveService } from './leave.service';
import { PayrollRunsService } from './payroll-runs.service';

const T = '11111111-1111-4111-8111-111111111111';
const ACTOR = '33333333-3333-4333-8333-333333333333';

function repo(rows: any[]) {
  let n = 0;
  const locks: string[] = [];
  const match = (r: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => r[k] === v);
  return {
    rows,
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
      for (const r of rows.filter((x) => match(x, where)))
        Object.assign(r, patch);
      return { affected: 1 };
    }),
    /** Only what lockRun uses; records the lock mode and returns a copy, like a row read. */
    locks,
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
    delete: jest.fn(async (where: any) => {
      const gone = rows.filter((x) => match(x, where));
      for (const x of gone) rows.splice(rows.indexOf(x), 1);
      return { affected: gone.length };
    }),
    remove: jest.fn(async (e: any) => {
      const list = Array.isArray(e) ? e : [e];
      for (const x of list) {
        const i = rows.indexOf(x);
        if (i !== -1) rows.splice(i, 1);
      }
      return e;
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
    emp('c', 'EMP-003', { status: 'ON_HOLD' }),
    emp('d', 'EMP-004', { status: 'LEFT', leavingDate: '2026-09-30' }),
    emp('e', 'EMP-005', { leavingDate: '2026-09-15' }),
    emp('f', 'EMP-006', { joiningDate: '2026-11-05' }),
    emp('g', 'EMP-007', { isNational: true }),
    emp('h', 'EMP-008'),
  ]);
  const packages = repo([
    pkg('pa1', 'a', '2024-01-01', 5000, 2000, 500),
    pkg('pa2', 'a', '2026-10-15', 6000, 2000, 500),
    pkg('pa3', 'a', '2026-11-01', 9000, 2000, 500),
    pkg('pb', 'b', '2026-10-16', 3100),
    pkg('pc', 'c', '2024-01-01', 4000),
    pkg('pd', 'd', '2024-01-01', 4000),
    pkg('pe', 'e', '2024-01-01', 4000),
    pkg('pf', 'f', '2026-11-05', 4000),
    pkg('pg', 'g', '2024-01-01', 9000),
  ]);
  const advances = repo([]);
  const runs = repo([]);
  const lines = repo([]);
  const gratuity = repo([]);
  const leaveLedger = repo([]);
  const orgs = repo([
    {
      id: T,
      name: 'Acme',
      legalName: 'Acme Trading LLC',
      baseCurrency: 'AED',
      addressLine1: 'Office 1',
      addressLine2: null,
      city: 'Dubai',
      region: null,
      postalCode: null,
      country: 'AE',
    },
  ]);
  const repos = new Map<any, any>([
    [Employee, employees],
    [SalaryPackage, packages],
    [EmployeeAdvance, advances],
    [PayrollRun, runs],
    [PayrollRunLine, lines],
    [GratuityLedgerEntry, gratuity],
    [LeaveLedgerEntry, leaveLedger],
    [Organization, orgs],
  ]);
  let seq = 0;
  const manager: any = {
    getRepository: (e: any) => repos.get(e),
    query: jest.fn(async () => [{ current_value: ++seq }]),
  };
  const dataSource: any = { manager, transaction: (cb: any) => cb(manager) };
  const ledger: any = {};
  const employeesService = new EmployeesService(
    dataSource,
    new PayrollCryptoService({}),
  );
  const gratuityService = new GratuityService(dataSource, ledger, employeesService);
  const service = new PayrollRunsService(
    dataSource,
    employeesService,
    new AdvancesService(dataSource, ledger),
    gratuityService,
    new LeaveService(
      dataSource,
      gratuityService,
      new PayrollSettingsService(dataSource),
      ledger,
      employeesService,
    ),
  );
  return { service, employees, packages, advances, runs, lines, gratuity, leaveLedger };
}

const lineOf = (dto: any, num: string) =>
  dto.lines.find((l: any) => l.employeeNumber === num);

describe('PayrollRunsService', () => {
  describe('create', () => {
    it('creates lines only for ACTIVE employees employed in the month; prorates a mid-month joiner', async () => {
      const { service } = setup();
      const run = await service.create(T, ACTOR, {
        period: '2026-10',
        payDate: null,
      });
      expect(run.status).toBe('DRAFT');
      expect(run.period).toBe('2026-10');
      expect(run.payDate).toBe('2026-10-28');
      expect(run.runNumber).toMatch(/^PR-\d{4}-0001$/);
      expect(run.lines!.map((l) => l.employeeNumber)).toEqual([
        'EMP-001',
        'EMP-002',
        'EMP-007',
      ]);
      const b = lineOf(run, 'EMP-002');
      expect(b.daysEmployed).toBe(16);
      expect(b.daysInMonth).toBe(31);
      expect(b.gross).toBe(3100);
      expect(b.proratedGross).toBe(1600);
      expect(b.netPay).toBe(1600);
      expect(b.paymentMethod).toBe('CASH');
    });

    it('uses the package in effect at month end (a raise effective the 15th applies to the whole month)', async () => {
      const { service } = setup();
      const run = await service.create(T, ACTOR, {
        period: '2026-10',
        payDate: '2026-10-30',
      });
      const a = lineOf(run, 'EMP-001');
      expect(a.basic).toBe(6000);
      expect(a.gross).toBe(8500);
      expect(a.daysEmployed).toBe(31);
      expect(a.proratedGross).toBe(8500);
      expect(run.payDate).toBe('2026-10-30');
      expect(run.totals.salaryCost).toBe(8500 + 1600 + 9000);
      expect(run.totals.net).toBe(8500 + 1600 + 9000);
      expect(run.totals.bankNet).toBe(8500 + 9000);
      expect(run.totals.cashNet).toBe(1600);
    });

    it('skips an employee with no package and reports it', async () => {
      const { service } = setup();
      const run = await service.create(T, ACTOR, {
        period: '2026-10',
        payDate: null,
      });
      expect(lineOf(run, 'EMP-008')).toBeUndefined();
      expect(run.warnings).toEqual([
        'EMP-008 has no salary package for October 2026',
      ]);
    });

    it('flags a national', async () => {
      const { service } = setup();
      const run = await service.create(T, ACTOR, {
        period: '2026-10',
        payDate: null,
      });
      expect(lineOf(run, 'EMP-007').flags).toEqual([
        'NATIONAL_PENSION_NOT_HANDLED',
      ]);
      expect(lineOf(run, 'EMP-001').flags).toEqual([]);
    });

    it('refuses a second run for the period; a voided run does not block', async () => {
      const { service, runs } = setup();
      const first = await service.create(T, ACTOR, {
        period: '2026-10',
        payDate: null,
      });
      await expect(
        service.create(T, ACTOR, { period: '2026-10', payDate: null }),
      ).rejects.toThrow(
        new ConflictException(
          `October 2026 already has payroll run ${first.runNumber}`,
        ),
      );
      runs.rows.find((r) => r.id === first.id).status = 'VOIDED';
      const second = await service.create(T, ACTOR, {
        period: '2026-10',
        payDate: null,
      });
      expect(second.id).not.toBe(first.id);
    });

    it('refuses a run at or before the gratuity cut-over', async () => {
      const { service, gratuity } = setup();
      gratuity.rows.push({
        id: 'g1',
        tenantId: T,
        employeeId: 'a',
        kind: 'OPENING',
        amount: 100,
        asOf: '2026-10-31',
      });
      await expect(
        service.create(T, ACTOR, { period: '2026-10', payDate: null }),
      ).rejects.toThrow(
        new ConflictException(
          'Gratuity opening balances were set up as of 2026-10-31; payroll for October 2026 is already in them',
        ),
      );
      await expect(
        service.create(T, ACTOR, { period: '2026-09', payDate: null }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.create(T, ACTOR, { period: '2026-11', payDate: null }),
      ).resolves.toBeDefined();
    });

    it('rejects a malformed period', async () => {
      const { service } = setup();
      await expect(
        service.create(T, ACTOR, { period: '2026-13', payDate: null }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('updateLine', () => {
    async function draft() {
      const s = setup();
      const run = await s.service.create(T, ACTOR, {
        period: '2026-10',
        payDate: null,
      });
      const a = lineOf(run, 'EMP-001');
      return { ...s, run, a };
    }

    it('recomputes the line and the run totals', async () => {
      const { service, run, a, advances } = await draft();
      advances.rows.push({
        id: 'adv',
        tenantId: T,
        employeeId: 'a',
        amount: 1000,
      });
      const got = await service.updateLine(T, run.id, a.id, {
        overtimeHours: 8,
        bonusAmount: 500,
        bonusLabel: 'Q3',
        unpaidLeaveDays: 1,
        advanceRecovery: 400,
        otherDeductionAmount: 100,
        otherDeductionLabel: 'Fine',
      });
      const line = lineOf(got, 'EMP-001');
      // 6000/30/8 × 1.25 × 8 = 250; 8500/30 = 283.33
      expect(line.overtimeAmount).toBe(250);
      expect(line.unpaidLeaveAmount).toBe(283.33);
      expect(line.salaryCost).toBe(8966.67);
      expect(line.netPay).toBe(8466.67);
      expect(line.bonusLabel).toBe('Q3');
      expect(got.totals).toMatchObject({
        overtime: 250,
        bonus: 500,
        unpaidLeave: 283.33,
        advanceRecovery: 400,
        otherDeductions: 100,
        salaryCost: 19566.67,
        net: 19066.67,
        bankNet: 17466.67,
        cashNet: 1600,
      });
    });

    it('locks the run before reading lines and writes back only the totals', async () => {
      const { service, run, a, runs, lines } = await draft();
      runs.save.mockClear();
      runs.locks.length = 0;
      lines.findOne.mockClear();
      // An approval field set by someone else must survive this edit.
      runs.rows.find((r) => r.id === run.id).approvedById = 'someone';

      await service.updateLine(T, run.id, a.id, { bonusAmount: 100 });

      expect(runs.locks).toEqual(['pessimistic_write']);
      expect(runs.createQueryBuilder.mock.invocationCallOrder[0]).toBeLessThan(
        lines.findOne.mock.invocationCallOrder[0],
      );
      expect(runs.save).not.toHaveBeenCalled();
      const [where, patch] = runs.update.mock.calls.at(-1);
      expect(where).toEqual({ id: run.id, tenantId: T });
      expect(Object.keys(patch).every((k) => k.startsWith('total'))).toBe(true);
      const stored = runs.rows.find((r) => r.id === run.id);
      expect(stored.totalBonus).toBe(100);
      expect(stored.status).toBe('DRAFT');
      expect(stored.approvedById).toBe('someone');
    });

    it('refuses a run that is not DRAFT', async () => {
      const { service, run, a, runs } = await draft();
      runs.rows.find((r) => r.id === run.id).status = 'APPROVED';
      await expect(
        service.updateLine(T, run.id, a.id, { bonusAmount: 1 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses advance recovery above the outstanding balance', async () => {
      const { service, run, a, advances } = await draft();
      advances.rows.push({
        id: 'adv',
        tenantId: T,
        employeeId: 'a',
        amount: 300,
      });
      await expect(
        service.updateLine(T, run.id, a.id, { advanceRecovery: 400 }),
      ).rejects.toThrow(
        new BadRequestException(
          "Only 300.00 of Emp EMP-001's advance is outstanding",
        ),
      );
    });

    it('refuses a negative net pay', async () => {
      const { service, run, a } = await draft();
      await expect(
        service.updateLine(T, run.id, a.id, { otherDeductionAmount: 9000 }),
      ).rejects.toThrow(
        new BadRequestException("Emp EMP-001's deductions exceed their pay"),
      );
    });

    it('refuses more unpaid leave days than days employed', async () => {
      const { service, run } = await draft();
      const b = lineOf(run, 'EMP-002');
      await expect(
        service.updateLine(T, run.id, b.id, { unpaidLeaveDays: 17 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('refresh', () => {
    it('keeps extras, adds a new joiner, drops an employee set to ON_HOLD', async () => {
      const { service, employees, packages } = setup();
      const run = await service.create(T, ACTOR, {
        period: '2026-10',
        payDate: null,
      });
      const a = lineOf(run, 'EMP-001');
      await service.updateLine(T, run.id, a.id, {
        bonusAmount: 500,
        bonusLabel: 'Q3',
      });

      employees.rows.find((e) => e.id === 'g').status = 'ON_HOLD';
      employees.rows.push(emp('i', 'EMP-009', { joiningDate: '2026-10-20' }));
      packages.rows.push(pkg('pi', 'i', '2026-10-20', 3100));
      packages.rows.push(pkg('pa4', 'a', '2026-10-31', 7000, 2000, 500));

      const got = await service.refresh(T, run.id);
      expect(got.lines!.map((l) => l.employeeNumber)).toEqual([
        'EMP-001',
        'EMP-002',
        'EMP-009',
      ]);
      const ra = lineOf(got, 'EMP-001');
      expect(ra.id).toBe(a.id);
      expect(ra.basic).toBe(7000);
      expect(ra.bonusAmount).toBe(500);
      expect(ra.bonusLabel).toBe('Q3');
      expect(ra.netPay).toBe(9500 + 500);
      expect(lineOf(got, 'EMP-009').daysEmployed).toBe(12);
      expect(got.warnings).toEqual([
        'EMP-008 has no salary package for October 2026',
      ]);
      expect(got.totals.net).toBe(10000 + 1600 + 1200);
    });

    it('locks the run before reading lines and writes back only the totals', async () => {
      const { service, runs, lines } = setup();
      const run = await service.create(T, ACTOR, {
        period: '2026-10',
        payDate: null,
      });
      runs.save.mockClear();
      runs.locks.length = 0;
      lines.find.mockClear();

      await service.refresh(T, run.id);

      expect(runs.locks).toEqual(['pessimistic_write']);
      expect(runs.createQueryBuilder.mock.invocationCallOrder[0]).toBeLessThan(
        lines.find.mock.invocationCallOrder[0],
      );
      expect(runs.save).not.toHaveBeenCalled();
      const [, patch] = runs.update.mock.calls.at(-1);
      expect(Object.keys(patch).every((k) => k.startsWith('total'))).toBe(true);
    });

    it('refuses a run that is not DRAFT', async () => {
      const { service, runs } = setup();
      const run = await service.create(T, ACTOR, {
        period: '2026-10',
        payDate: null,
      });
      runs.rows.find((r) => r.id === run.id).status = 'APPROVED';
      await expect(service.refresh(T, run.id)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('leavers', () => {
    it('pays a LEFT employee for the days up to the leaving date in their final month', async () => {
      const { service, employees } = setup();
      Object.assign(employees.rows.find((e) => e.id === 'a'), {
        status: 'LEFT',
        leavingDate: '2026-10-15',
      });
      const run = await service.create(T, ACTOR, { period: '2026-10', payDate: null });
      const a = lineOf(run, 'EMP-001');
      expect(a.daysEmployed).toBe(15);
      expect(a.proratedGross).toBe(4112.9); // 8500 × 15 / 31
      // LEFT before the month (EMP-004) still gets no line.
      expect(lineOf(run, 'EMP-004')).toBeUndefined();
      const nov = await service.create(T, ACTOR, { period: '2026-11', payDate: null });
      expect(lineOf(nov, 'EMP-001')).toBeUndefined();
    });

    it('refresh keeps the line of an employee who left during the month', async () => {
      const { service, employees } = setup();
      const run = await service.create(T, ACTOR, { period: '2026-10', payDate: null });
      const a = lineOf(run, 'EMP-001');
      await service.updateLine(T, run.id, a.id, { bonusAmount: 200 });
      Object.assign(employees.rows.find((e) => e.id === 'a'), {
        status: 'LEFT',
        leavingDate: '2026-10-15',
      });
      const got = await service.refresh(T, run.id);
      const ra = lineOf(got, 'EMP-001');
      expect(ra.id).toBe(a.id);
      expect(ra.daysEmployed).toBe(15);
      expect(ra.bonusAmount).toBe(200);
    });
  });

  describe('remove', () => {
    it('deletes a draft and its lines after locking the run', async () => {
      const { service, runs, lines } = setup();
      const run = await service.create(T, ACTOR, { period: '2026-10', payDate: null });
      runs.locks.length = 0;
      await service.remove(T, run.id);
      expect(runs.locks).toEqual(['pessimistic_write']);
      expect(runs.rows).toHaveLength(0);
      expect(lines.rows).toHaveLength(0);
      expect(lines.delete).toHaveBeenCalledWith({ tenantId: T, runId: run.id });
      expect(runs.delete).toHaveBeenCalledWith({ id: run.id, tenantId: T });
    });

    it('refuses (409) anything but a draft, and 404s another tenant', async () => {
      const { service, runs, lines } = setup();
      const run = await service.create(T, ACTOR, { period: '2026-10', payDate: null });
      for (const status of ['APPROVED', 'PARTIALLY_PAID', 'PAID', 'VOIDED']) {
        runs.rows[0].status = status;
        await expect(service.remove(T, run.id)).rejects.toBeInstanceOf(ConflictException);
      }
      runs.rows[0].status = 'DRAFT';
      await expect(
        service.remove('99999999-9999-4999-8999-999999999999', run.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(runs.rows).toHaveLength(1);
      expect(lines.rows.length).toBeGreaterThan(0);
      expect(lines.delete).not.toHaveBeenCalled();
    });
  });

  describe('list and get', () => {
    it('lists runs without lines and gets one with lines', async () => {
      const { service } = setup();
      const run = await service.create(T, ACTOR, {
        period: '2026-10',
        payDate: null,
      });
      const { runs: list, openingGratuityCutover } = await service.list(T);
      expect(openingGratuityCutover).toBeNull();
      expect(list).toHaveLength(1);
      expect(list[0].lines).toBeUndefined();
      const got = await service.get(T, run.id);
      expect(got.lines!.map((l) => l.employeeNumber)).toEqual([
        'EMP-001',
        'EMP-002',
        'EMP-007',
      ]);
    });
  });

  describe('list cut-over', () => {
    it('reports the latest opening gratuity cut-over', async () => {
      const { service, gratuity } = setup();
      gratuity.rows.push({
        id: 'g1',
        tenantId: T,
        employeeId: 'a',
        kind: 'OPENING',
        amount: 100,
        asOf: '2026-09-30',
      });
      const out = await service.list(T);
      expect(out.openingGratuityCutover).toBe('2026-09-30');
      expect(out.runs).toEqual([]);
      expect(out.openingLeaveCutover).toBeNull();
    });

    it('reports the latest opening leave cut-over', async () => {
      const { service, leaveLedger } = setup();
      leaveLedger.rows.push({
        id: 'l1',
        tenantId: T,
        employeeId: 'a',
        kind: 'OPENING',
        days: 5,
        amount: 100,
        asOf: '2026-09-30',
      });
      expect((await service.list(T)).openingLeaveCutover).toBe('2026-09-30');
    });
  });

  describe('payslip', () => {
    it('returns the line, the employee with a masked IBAN, and the organization', async () => {
      const { service } = setup();
      const run = await service.create(T, ACTOR, {
        period: '2026-10',
        payDate: null,
      });
      const a = lineOf(run, 'EMP-001');
      const slip = await service.payslip(T, run.id, a.id);
      expect(slip.run).toEqual({
        id: run.id,
        runNumber: run.runNumber,
        period: '2026-10',
        payDate: '2026-10-28',
        status: 'DRAFT',
      });
      expect(slip.line.id).toBe(a.id);
      expect(slip.employee).toEqual({
        id: 'a',
        employeeNumber: 'EMP-001',
        fullName: 'Emp EMP-001',
        jobTitle: 'Technician',
        department: 'Ops',
        joiningDate: '2024-01-01',
        paymentMethod: 'BANK',
        bankName: 'ENBD',
        ibanMasked: '•••• 1234',
      });
      expect(JSON.stringify(slip)).not.toContain('cipher');
      expect(slip.organization).toEqual({
        name: 'Acme',
        legalName: 'Acme Trading LLC',
        address: 'Office 1, Dubai, AE',
        baseCurrency: 'AED',
      });
    });
  });
});
