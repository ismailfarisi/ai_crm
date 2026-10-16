import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Between, DataSource, In } from 'typeorm';
import {
  daysEmployed,
  labourCost,
  periodBounds,
  round2,
  TIMESHEET_INDIRECT_CATEGORIES,
  type LabourUtilisationDto,
  type LabourUtilisationRowDto,
  type TimesheetIndirectCategory,
} from '@saas/shared';
import { Employee } from '../payroll/entities/employee.entity';
import { PayrollSettings } from '../payroll/entities/payroll-settings.entity';
import {
  PayrollRun,
  PayrollRunLine,
} from '../payroll/entities/payroll-run.entity';
import { POSTED_RUN_STATUSES } from '../payroll/advances.service';
import { WorkOrder } from '../production/entities/work-order.entity';
import { TimesheetEntry } from './entities/timesheet-entry.entity';
import { JobCostService } from './job-cost.service';

/** `payroll_settings` default when a tenant has no row (as in JobCostService). */
const DEFAULT_MONTHLY_STANDARD_HOURS = 208;

type Numbers = LabourUtilisationDto['totals'];

const emptyIndirect = () =>
  Object.fromEntries(
    TIMESHEET_INDIRECT_CATEGORIES.map((c) => [c, 0]),
  ) as Record<TimesheetIndirectCategory, number>;

function indirectHoursOf(entries: TimesheetEntry[]) {
  const out = emptyIndirect();
  for (const e of entries) {
    if (e.indirectCategory)
      out[e.indirectCategory] = round2(
        out[e.indirectCategory] + Number(e.hours),
      );
  }
  return out;
}

/**
 * Where a month's paid hours went: onto jobs (absorbed), into indirect
 * categories, or nowhere (unlogged). Once the month's payroll has posted the
 * figures are the frozen ones on the run's lines; before that they are
 * estimates at each employee's estimated rate and the report says so.
 *
 * Reads payroll's tables directly: PayrollModule depends on this module.
 */
@Injectable()
export class LabourUtilisationService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly jobCost: JobCostService,
  ) {}

  async forPeriod(
    tenantId: string,
    period: string,
  ): Promise<LabourUtilisationDto> {
    const manager = this.dataSource.manager;
    const { first, last } = periodBounds(period);
    const [run] = await manager.getRepository(PayrollRun).find({
      where: { tenantId, period, status: In([...POSTED_RUN_STATUSES]) },
    });
    const entries = await manager
      .getRepository(TimesheetEntry)
      .find({ where: { tenantId, workDate: Between(first, last) } });
    const byEmployee = new Map<string, TimesheetEntry[]>();
    for (const e of entries) {
      const list = byEmployee.get(e.employeeId) ?? [];
      list.push(e);
      byEmployee.set(e.employeeId, list);
    }

    const rows = run
      ? await this.actualRows(tenantId, run, byEmployee)
      : await this.provisionalRows(tenantId, period, byEmployee);
    rows.sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber));
    return {
      period,
      status: run ? 'ACTUAL' : 'PROVISIONAL',
      rows,
      totals: this.totals(rows),
    };
  }

  private async actualRows(
    tenantId: string,
    run: PayrollRun,
    byEmployee: Map<string, TimesheetEntry[]>,
  ): Promise<LabourUtilisationRowDto[]> {
    const lines = await this.dataSource.manager
      .getRepository(PayrollRunLine)
      .find({ where: { tenantId, runId: run.id } });
    return lines.map((line) => {
      const mine = byEmployee.get(line.employeeId) ?? [];
      const cost = labourCost({
        salaryCost: line.salaryCost,
        pensionEmployer: line.pensionEmployer ?? 0,
        gratuityAccrual: line.gratuityAccrual ?? 0,
        leaveProvisionChange: line.leaveProvisionChange ?? 0,
      });
      const absorbed = Number(line.labourAbsorbed ?? 0);
      const standard = Number(line.standardHours ?? 0);
      return {
        employeeId: line.employeeId,
        employeeNumber: line.employeeNumber,
        employeeName: line.employeeName,
        standardHours: standard,
        directHours: Number(line.directHours ?? 0),
        indirectHours: indirectHoursOf(mine),
        unloggedHours: Math.max(
          0,
          round2(standard - Number(line.loggedHours ?? 0)),
        ),
        cost,
        absorbed,
        unabsorbed: round2(cost - absorbed),
      };
    });
  }

  private async provisionalRows(
    tenantId: string,
    period: string,
    byEmployee: Map<string, TimesheetEntry[]>,
  ): Promise<LabourUtilisationRowDto[]> {
    const manager = this.dataSource.manager;
    const [employees, settings] = await Promise.all([
      manager.getRepository(Employee).find({ where: { tenantId } }),
      manager.getRepository(PayrollSettings).findOne({ where: { tenantId } }),
    ]);
    const monthlyHours =
      settings?.monthlyStandardHours ?? DEFAULT_MONTHLY_STANDARD_HOURS;
    const { daysInMonth } = periodBounds(period);

    const workOrderIds = [
      ...new Set(
        [...byEmployee.values()]
          .flat()
          .flatMap((e) =>
            e.operationId && e.workOrderId ? [e.workOrderId] : [],
          ),
      ),
    ];
    const cancelled = new Set(
      workOrderIds.length
        ? (
            await manager
              .getRepository(WorkOrder)
              .find({ where: { tenantId, id: In(workOrderIds) } })
          )
            .filter((w) => w.status === 'CANCELLED')
            .map((w) => w.id)
        : [],
    );

    const cache = new Map<string, number>();
    const rows: LabourUtilisationRowDto[] = [];
    for (const emp of employees) {
      const days = daysEmployed({
        period,
        joiningDate: emp.joiningDate,
        leavingDate: emp.leavingDate,
      });
      const mine = byEmployee.get(emp.id) ?? [];
      // The employees payroll would run (payroll-runs.service `eligible`), plus
      // anyone with hours in the month, so logged time always shows.
      const payrollRuns =
        emp.status === 'ACTIVE' || (emp.status === 'LEFT' && !!emp.leavingDate);
      if (!(payrollRuns && days > 0) && !mine.length) continue;
      const standard = round2((Math.max(days, 0) / daysInMonth) * monthlyHours);
      const rate = await this.jobCost.estimatedRate(
        manager,
        tenantId,
        emp.id,
        period,
        cache,
      );
      const direct = mine.filter((e) => e.operationId);
      const sumHours = (list: TimesheetEntry[]) =>
        round2(list.reduce((s, e) => s + Number(e.hours), 0));
      const chargedHours = sumHours(
        direct.filter((e) => e.workOrderId && !cancelled.has(e.workOrderId)),
      );
      const cost = round2(rate * standard);
      const absorbed = round2(rate * chargedHours);
      rows.push({
        employeeId: emp.id,
        employeeNumber: emp.employeeNumber,
        employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
        standardHours: standard,
        directHours: sumHours(direct),
        indirectHours: indirectHoursOf(mine),
        unloggedHours: Math.max(0, round2(standard - sumHours(mine))),
        cost,
        absorbed,
        unabsorbed: round2(cost - absorbed),
      });
    }
    return rows;
  }

  private totals(rows: LabourUtilisationRowDto[]): Numbers {
    const sum = (f: (r: LabourUtilisationRowDto) => number) =>
      round2(rows.reduce((s, r) => s + f(r), 0));
    return {
      standardHours: sum((r) => r.standardHours),
      directHours: sum((r) => r.directHours),
      indirectHours: Object.fromEntries(
        TIMESHEET_INDIRECT_CATEGORIES.map((c) => [
          c,
          sum((r) => r.indirectHours[c]),
        ]),
      ) as Record<TimesheetIndirectCategory, number>,
      unloggedHours: sum((r) => r.unloggedHours),
      cost: sum((r) => r.cost),
      absorbed: sum((r) => r.absorbed),
      unabsorbed: sum((r) => r.unabsorbed),
    };
  }
}
