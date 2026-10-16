import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS } from '@saas/shared';
import { PERMISSIONS_KEY } from '@/common/decorators';
import { Employee } from '../payroll/entities/employee.entity';
import { PayrollSettings } from '../payroll/entities/payroll-settings.entity';
import {
  PayrollRun,
  PayrollRunLine,
} from '../payroll/entities/payroll-run.entity';
import { WorkOrder } from '../production/entities/work-order.entity';
import { TimesheetEntry } from './entities/timesheet-entry.entity';
import { LabourUtilisationController } from './labour-utilisation.controller';
import { LabourUtilisationService } from './labour-utilisation.service';

const T = 't1';

function harness(fixtures: {
  runs?: object[];
  lines?: object[];
  entries?: object[];
  employees?: object[];
  workOrders?: object[];
  rates?: Record<string, number>;
}) {
  const find = new Map<unknown, object[]>([
    [PayrollRun, fixtures.runs ?? []],
    [PayrollRunLine, fixtures.lines ?? []],
    [TimesheetEntry, fixtures.entries ?? []],
    [Employee, fixtures.employees ?? []],
    [WorkOrder, fixtures.workOrders ?? []],
  ]);
  const wheres: { entity: unknown; where: Record<string, unknown> }[] = [];
  const manager = {
    getRepository: (entity: unknown) => ({
      find: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        wheres.push({ entity, where });
        return find.get(entity) ?? [];
      }),
      findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        wheres.push({ entity, where });
        return entity === PayrollSettings ? { monthlyStandardHours: 208 } : null;
      }),
    }),
  };
  const jobCost = {
    estimatedRate: jest.fn(
      async (_m: unknown, _t: string, employeeId: string) =>
        fixtures.rates?.[employeeId] ?? 0,
    ),
  };
  const service = new LabourUtilisationService(
    { manager } as never,
    jobCost as never,
  );
  return { service, wheres, jobCost };
}

const entry = (employeeId: string, hours: number, rest: object) => ({
  employeeId,
  hours,
  workOrderId: null,
  operationId: null,
  indirectCategory: null,
  ...rest,
});
const direct = (employeeId: string, hours: number, workOrderId = 'wo-1') =>
  entry(employeeId, hours, { workOrderId, operationId: 'op-1' });
const indirect = (employeeId: string, hours: number, cat: string) =>
  entry(employeeId, hours, { indirectCategory: cat });

describe('LabourUtilisationService.forPeriod', () => {
  it('reads a posted month off the run lines: IDLE/TRAINING split, unlogged hours, unabsorbed', async () => {
    const { service, wheres } = harness({
      runs: [{ id: 'run-1', period: '2026-06', status: 'APPROVED' }],
      lines: [
        {
          runId: 'run-1',
          employeeId: 'e1',
          employeeNumber: 'E-001',
          employeeName: 'Amal One',
          salaryCost: 5000,
          pensionEmployer: 0,
          gratuityAccrual: 200,
          leaveProvisionChange: 100,
          standardHours: 208,
          loggedHours: 200,
          directHours: 150,
          labourAbsorbed: 3822.12,
        },
        {
          runId: 'run-1',
          employeeId: 'e2',
          employeeNumber: 'E-002',
          employeeName: 'Bilal Two',
          salaryCost: 3000,
          pensionEmployer: 0,
          gratuityAccrual: 100,
          leaveProvisionChange: 50,
          standardHours: 208,
          loggedHours: 220,
          directHours: 100,
          labourAbsorbed: 1431.82,
        },
      ],
      entries: [
        direct('e1', 150),
        indirect('e1', 30, 'TRAINING'),
        indirect('e1', 20, 'IDLE'),
        direct('e2', 100),
        indirect('e2', 120, 'IDLE'),
      ],
    });

    const report = await service.forPeriod(T, '2026-06');

    expect(report.status).toBe('ACTUAL');
    const [a, b] = report.rows;
    expect(a).toMatchObject({
      employeeNumber: 'E-001',
      standardHours: 208,
      directHours: 150,
      unloggedHours: 8,
      cost: 5300,
      absorbed: 3822.12,
    });
    expect(a.indirectHours).toEqual({
      CLEANING: 0,
      MAINTENANCE: 0,
      TRAINING: 30,
      IDLE: 20,
      OTHER: 0,
    });
    expect(b.unloggedHours).toBe(0); // logged more than standard
    expect(b.indirectHours.IDLE).toBe(120);

    // Independent figures: the unabsorbed cost is what the run's lines
    // charged (salary + on-costs, from the fixtures above) less what the lines
    // say jobs absorbed. Literal numbers, not derived from the report.
    expect(a.unabsorbed).toBe(1477.88); // 5300 - 3822.12
    expect(b.unabsorbed).toBe(1718.18); // 3150 - 1431.82
    expect(report.totals).toMatchObject({
      cost: 8450,
      absorbed: 5253.94,
      unabsorbed: 3196.06, // (5000+3000+200+100+100+50) - (3822.12+1431.82)
      standardHours: 416,
      directHours: 250,
      unloggedHours: 8,
    });
    expect(report.totals.indirectHours).toEqual({
      CLEANING: 0,
      MAINTENANCE: 0,
      TRAINING: 30,
      IDLE: 140,
      OTHER: 0,
    });
    // Every query is tenant-scoped.
    expect(wheres.length).toBeGreaterThan(0);
    for (const w of wheres) expect(w.where.tenantId).toBe(T);
  });

  it('estimates an unposted month at estimated rates and says PROVISIONAL', async () => {
    const { service, wheres } = harness({
      employees: [
        {
          id: 'e1',
          employeeNumber: 'E-001',
          firstName: 'Amal',
          lastName: 'One',
          joiningDate: '2024-01-01',
          leavingDate: null,
        },
        {
          // Joined on the 16th: 15 of 30 days.
          id: 'e2',
          employeeNumber: 'E-002',
          firstName: 'Bilal',
          lastName: 'Two',
          joiningDate: '2026-06-16',
          leavingDate: null,
        },
        {
          // Left before the month: not in the report.
          id: 'e3',
          employeeNumber: 'E-003',
          firstName: 'Cara',
          lastName: 'Three',
          joiningDate: '2023-01-01',
          leavingDate: '2026-03-31',
        },
      ],
      entries: [
        direct('e1', 100, 'wo-live'),
        direct('e1', 20, 'wo-cancelled'),
        indirect('e1', 8, 'CLEANING'),
      ],
      workOrders: [{ id: 'wo-cancelled', status: 'CANCELLED' }],
      rates: { e1: 20, e2: 10 },
    });

    const report = await service.forPeriod(T, '2026-06');

    expect(report.status).toBe('PROVISIONAL');
    expect(report.rows.map((r) => r.employeeNumber)).toEqual([
      'E-001',
      'E-002',
    ]);
    const [a, b] = report.rows;
    expect(a).toMatchObject({
      standardHours: 208,
      directHours: 120,
      unloggedHours: 80, // 208 - (120 + 8)
      cost: 4160, // 20 x 208
      absorbed: 2000, // 20 x 100: the cancelled job's 20 hours are not absorbed
      unabsorbed: 2160,
    });
    expect(a.indirectHours.CLEANING).toBe(8);
    expect(b).toMatchObject({
      standardHours: 104, // 15/30 x 208
      cost: 1040,
      absorbed: 0,
      unabsorbed: 1040,
      unloggedHours: 104,
    });
    expect(report.totals).toMatchObject({
      standardHours: 312,
      cost: 5200,
      absorbed: 2000,
      unabsorbed: 3200,
    });
    for (const w of wheres) expect(w.where.tenantId).toBe(T);
  });
});

describe('LabourUtilisationController', () => {
  const handler = LabourUtilisationController.prototype.forPeriod;

  it('serves GET /finance/reports/labour-utilisation behind finance:read and payroll:read', () => {
    expect(Reflect.getMetadata(PATH_METADATA, LabourUtilisationController)).toBe(
      'finance',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      'reports/labour-utilisation',
    );
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([
      PERMISSIONS.FINANCE_READ,
      PERMISSIONS.PAYROLL_READ,
    ]);
  });

  it('passes the caller tenant and period to the service', async () => {
    const service = { forPeriod: jest.fn(async () => ({ period: '2026-06' })) };
    const controller = new LabourUtilisationController(service as never);
    await controller.forPeriod({ organizationId: 'tenant-9' } as never, {
      period: '2026-06',
    });
    expect(service.forPeriod).toHaveBeenCalledWith('tenant-9', '2026-06');
  });
});
