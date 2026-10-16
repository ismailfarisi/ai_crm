import { Injectable } from '@nestjs/common';
import { In, type EntityManager } from 'typeorm';
import {
  actualCost,
  estimatedLabourRate,
  labourStatus,
  packageGross,
  pensionContribution,
  periodBounds,
  round2,
  round4,
  unlinkedHours,
  type CostSplit,
  type LabourSplit,
  type LabourStatus,
  type WorkOrderLabourDto,
  type WorkOrderLabourEmployeeDto,
} from '@saas/shared';
import { Employee } from '../payroll/entities/employee.entity';
import { PayrollSettings } from '../payroll/entities/payroll-settings.entity';
import { PensionScheme } from '../payroll/entities/pension-scheme.entity';
import { SalaryPackage } from '../payroll/entities/salary-package.entity';
import {
  WorkOrder,
  WorkOrderMaterial,
  WorkOrderOperation,
} from '../production/entities/work-order.entity';
import { TimesheetEntry } from './entities/timesheet-entry.entity';
import { WorkOrderLabour } from './entities/work-order-labour.entity';

/** `payroll_settings` defaults when a tenant has no row (PayrollSettingsService DEFAULTS). */
const DEFAULT_MONTHLY_STANDARD_HOURS = 208;
const DEFAULT_ANNUAL_LEAVE_DAYS = 30;

export interface JobLabourSplit {
  split: LabourSplit;
  unlinkedHours: number;
  byEmployee: WorkOrderLabourEmployeeDto[];
}

/**
 * The actual labour cost of jobs, in three parts: **actual** (absorbed by a
 * posted payroll run, `work_order_labour`), **provisional** (timesheet hours
 * not yet absorbed, at the employee's estimated rate) and **unlinked**
 * (operation minutes no timesheet accounts for, at the operation's standard
 * labour rate).
 *
 * Reads payroll's tables directly: PayrollModule depends on this module (the
 * approval recomputes jobs), so it cannot inject payroll's services.
 */
@Injectable()
export class JobCostService {
  /**
   * The cost of an hour of the employee's time before the month's payroll
   * posts: their package in force on the period's last day plus statutory
   * on-costs, over the tenant's standard hours. No package → 0.
   */
  async estimatedRate(
    manager: EntityManager,
    tenantId: string,
    employeeId: string,
    period: string,
    cache?: Map<string, number>,
  ): Promise<number> {
    const key = `${employeeId}:${period}`;
    const hit = cache?.get(key);
    if (hit != null) return hit;

    const rate = await this.computeEstimatedRate(
      manager,
      tenantId,
      employeeId,
      period,
    );
    cache?.set(key, rate);
    return rate;
  }

  private async computeEstimatedRate(
    manager: EntityManager,
    tenantId: string,
    employeeId: string,
    period: string,
  ): Promise<number> {
    const employee = await manager
      .getRepository(Employee)
      .findOne({ where: { id: employeeId, tenantId }, withDeleted: true });
    if (!employee) return 0;

    // Same rule as EmployeesService.packageAt: greatest effectiveFrom on or before the day.
    const { last } = periodBounds(period);
    const packages = await manager
      .getRepository(SalaryPackage)
      .find({ where: { tenantId, employeeId } });
    let pkg: SalaryPackage | null = null;
    for (const p of packages) {
      if (
        p.effectiveFrom <= last &&
        (!pkg || p.effectiveFrom > pkg.effectiveFrom)
      ) {
        pkg = p;
      }
    }
    if (!pkg) return 0;

    const settings = await manager
      .getRepository(PayrollSettings)
      .findOne({ where: { tenantId } });
    // Same rule as PayrollSettingsService.annualDaysFor.
    const annualLeaveDays =
      employee.annualLeaveDaysOverride ??
      settings?.annualLeaveDays ??
      DEFAULT_ANNUAL_LEAVE_DAYS;
    const monthlyStandardHours =
      settings?.monthlyStandardHours ?? DEFAULT_MONTHLY_STANDARD_HOURS;

    const gross = packageGross({
      basic: pkg.basic,
      housing: pkg.housing,
      transport: pkg.transport,
      otherAllowances: pkg.otherAllowances ?? [],
    });

    // Same rule as PensionService.activeSchemeFor: the assigned scheme, only while active.
    let pensionEmployer = 0;
    if (employee.isNational && employee.pensionSchemeId) {
      const scheme = await manager.getRepository(PensionScheme).findOne({
        where: { id: employee.pensionSchemeId, tenantId },
      });
      if (scheme?.isActive) {
        pensionEmployer = pensionContribution({
          rates: {
            employeePct: scheme.employeePct,
            employerPct: scheme.employerPct,
            base: scheme.base,
            minSalary: scheme.minSalary,
            maxSalary: scheme.maxSalary,
          },
          basic: pkg.basic,
          housing: pkg.housing,
          gross,
          daysEmployed: 30,
          daysInMonth: 30,
        }).employer;
      }
    }

    return estimatedLabourRate({
      gross,
      basic: pkg.basic,
      pensionEmployer,
      isNational: employee.isNational,
      annualLeaveDays,
      monthlyStandardHours,
    });
  }

  /** The work order's labour in its three parts, with a row per employee and status. */
  async split(
    manager: EntityManager,
    tenantId: string,
    workOrderId: string,
  ): Promise<JobLabourSplit> {
    const ops = await manager
      .getRepository(WorkOrderOperation)
      .find({ where: { workOrderId, tenantId } });
    return this.splitWith(manager, tenantId, workOrderId, ops);
  }

  /** `split` against operations the caller already holds (completion has just changed their statuses). */
  private async splitWith(
    manager: EntityManager,
    tenantId: string,
    workOrderId: string,
    ops: WorkOrderOperation[],
  ): Promise<JobLabourSplit> {
    const [absorbed, entries] = await Promise.all([
      manager
        .getRepository(WorkOrderLabour)
        .find({ where: { tenantId, workOrderId } }),
      manager
        .getRepository(TimesheetEntry)
        .find({ where: { tenantId, workOrderId } }),
    ]);

    // Actual: what posted runs absorbed, per employee.
    const actualBy = new Map<string, { hours: number; amount: number }>();
    for (const row of absorbed) {
      const a = actualBy.get(row.employeeId) ?? { hours: 0, amount: 0 };
      a.hours += Number(row.hours);
      a.amount += Number(row.amount);
      actualBy.set(row.employeeId, a);
    }

    // Provisional: unabsorbed hours, priced per employee-month at that month's estimate.
    const pendingBy = new Map<string, Map<string, number>>();
    for (const e of entries) {
      if (e.runLineId != null) continue;
      const months = pendingBy.get(e.employeeId) ?? new Map<string, number>();
      const period = e.workDate.slice(0, 7);
      months.set(period, (months.get(period) ?? 0) + Number(e.hours));
      pendingBy.set(e.employeeId, months);
    }
    const cache = new Map<string, number>();
    const provisionalBy = new Map<
      string,
      { hours: number; amount: number; rate: number }
    >();
    for (const [employeeId, months] of pendingBy) {
      const p = { hours: 0, amount: 0, rate: 0 };
      for (const period of [...months.keys()].sort()) {
        const hours = round2(months.get(period)!);
        const rate = await this.estimatedRate(
          manager,
          tenantId,
          employeeId,
          period,
          cache,
        );
        p.hours += hours;
        p.amount += round2(hours * rate);
        p.rate = rate; // the latest month's
      }
      provisionalBy.set(employeeId, p);
    }

    // Unlinked: operation minutes beyond every entry on the operation, at its standard rate.
    const entryHoursByOp = new Map<string, number>();
    for (const e of entries) {
      if (!e.operationId) continue;
      entryHoursByOp.set(
        e.operationId,
        (entryHoursByOp.get(e.operationId) ?? 0) + Number(e.hours),
      );
    }
    let unlinkedTotalHours = 0;
    let unlinkedAmount = 0;
    for (const op of ops) {
      if (op.status === 'SKIPPED') continue;
      const hours = unlinkedHours(
        Number(op.actualMinutes),
        round2(entryHoursByOp.get(op.id) ?? 0),
      );
      unlinkedTotalHours += hours;
      unlinkedAmount += hours * Number(op.laborCostPerHour);
    }

    const ids = [...new Set([...actualBy.keys(), ...provisionalBy.keys()])];
    const employees = ids.length
      ? await manager
          .getRepository(Employee)
          .find({ where: { tenantId, id: In(ids) }, withDeleted: true })
      : [];
    const nameOf = (id: string) => {
      const e = employees.find((x) => x.id === id);
      return e ? `${e.firstName} ${e.lastName}` : 'Unknown employee';
    };

    const byEmployee: WorkOrderLabourEmployeeDto[] = [];
    for (const [employeeId, a] of actualBy) {
      const hours = round2(a.hours);
      const amount = round2(a.amount);
      byEmployee.push({
        employeeId,
        employeeName: nameOf(employeeId),
        hours,
        rate: hours > 0 ? round4(amount / hours) : 0,
        amount,
        status: 'ACTUAL',
      });
    }
    for (const [employeeId, p] of provisionalBy) {
      byEmployee.push({
        employeeId,
        employeeName: nameOf(employeeId),
        hours: round2(p.hours),
        rate: p.rate,
        amount: round2(p.amount),
        status: 'PROVISIONAL',
      });
    }
    byEmployee.sort(
      (x, y) =>
        x.employeeName.localeCompare(y.employeeName) ||
        x.employeeId.localeCompare(y.employeeId) ||
        (x.status === y.status ? 0 : x.status === 'ACTUAL' ? -1 : 1),
    );

    const sum = (status: 'ACTUAL' | 'PROVISIONAL') =>
      round2(
        byEmployee
          .filter((r) => r.status === status)
          .reduce((s, r) => s + (r.amount ?? 0), 0),
      );
    return {
      split: {
        actual: sum('ACTUAL'),
        provisional: sum('PROVISIONAL'),
        unlinked: round2(unlinkedAmount),
      },
      unlinkedHours: round2(unlinkedTotalHours),
      byEmployee,
    };
  }

  /**
   * The work order's actual cost with labour from the split, overhead
   * reapplied on top as the engine does. `ops` are the job's operations as
   * the caller holds them.
   */
  async costFor(
    manager: EntityManager,
    tenantId: string,
    wo: WorkOrder,
    ops: WorkOrderOperation[],
    materialValue: number,
    qtyCompleted: number,
  ): Promise<{
    cost: CostSplit;
    split: LabourSplit;
    status: LabourStatus | null;
  }> {
    const { split } = await this.splitWith(manager, tenantId, wo.id, ops);
    const cost = actualCost({
      operations: ops.map((op) => ({
        workCenterId: op.workCenterId,
        workCenterName: op.workCenterName,
        status: op.status,
        estimatedSetupMinutes: op.estimatedSetupMinutes,
        estimatedRunMinutes: op.estimatedRunMinutes,
        estimatedChargedMinutes: op.estimatedChargedMinutes,
        actualMinutes: op.actualMinutes,
        machineCostPerHour: op.machineCostPerHour,
        laborCostPerHour: op.laborCostPerHour,
      })),
      materialValue,
      toolingCost: wo.estimatedCost?.tooling ?? 0,
      overheadPct: wo.overheadPct,
      qtyCompleted,
      labour: round2(split.actual + split.provisional + split.unlinked),
    });
    return { cost, split, status: labourStatus(split) };
  }

  /**
   * Rewrites `actualCost`, `labourStatus` and `labourSplit` of the given
   * work orders that are COMPLETE; others are left alone. Callers hold
   * `lockJobCosting` and the work order rows. Writes only those columns.
   */
  async recompute(
    manager: EntityManager,
    tenantId: string,
    workOrderIds: string[],
  ): Promise<void> {
    for (const id of [...new Set(workOrderIds)].sort()) {
      const wo = await manager
        .getRepository(WorkOrder)
        .findOne({ where: { id, tenantId } });
      if (!wo || wo.status !== 'COMPLETE') continue;
      const [ops, mats] = await Promise.all([
        manager
          .getRepository(WorkOrderOperation)
          .find({ where: { workOrderId: id, tenantId } }),
        manager
          .getRepository(WorkOrderMaterial)
          .find({ where: { workOrderId: id, tenantId } }),
      ]);
      const materialValue = round2(
        mats.reduce((s, m) => s + Number(m.valueIssued), 0),
      );
      const { cost, split, status } = await this.costFor(
        manager,
        tenantId,
        wo,
        ops,
        materialValue,
        wo.qtyCompleted ?? wo.qty,
      );
      await manager
        .getRepository(WorkOrder)
        .update(
          { id, tenantId },
          { actualCost: cost, labourStatus: status, labourSplit: split },
        );
    }
  }

  /**
   * The labour panel of a work order. Hours are always present; amounts need
   * `cost` (quote:view_cost); a per-employee rate or amount also needs `pay`
   * (payroll:read).
   */
  async breakdown(
    manager: EntityManager,
    tenantId: string,
    workOrderId: string,
    visibility: { cost: boolean; pay: boolean },
  ): Promise<WorkOrderLabourDto> {
    const {
      split,
      unlinkedHours: hours,
      byEmployee,
    } = await this.split(manager, tenantId, workOrderId);
    const { cost } = visibility;
    const pay = visibility.cost && visibility.pay;
    return {
      actual: cost ? split.actual : null,
      provisional: cost ? split.provisional : null,
      unlinked: cost ? split.unlinked : null,
      total: cost
        ? round2(split.actual + split.provisional + split.unlinked)
        : null,
      unlinkedHours: hours,
      status: labourStatus(split),
      byEmployee: byEmployee.map((r) => ({
        ...r,
        rate: pay ? r.rate : null,
        amount: pay ? r.amount : null,
      })),
    };
  }
}
