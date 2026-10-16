import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { QueryFailedError, type DataSource, type EntityManager } from 'typeorm';
import {
  computeLine,
  daysEmployed,
  packageGross,
  periodBounds,
  round2,
  type CreatePayrollRunPayload,
  type PayrollRunDto,
  type PayrollRunsListDto,
  type PayrollRunLineDto,
  type PayslipDto,
  type UpdatePayrollLinePayload,
} from '@saas/shared';
import {
  allocateNextSequenceValue,
  formatSequenceNumber,
} from '@/database/tenant-sequence.util';
import { Organization } from '../organizations/entities/organization.entity';
import { Employee } from './entities/employee.entity';
import type { SalaryPackage } from './entities/salary-package.entity';
import { PayrollRun, PayrollRunLine } from './entities/payroll-run.entity';
import { EmployeesService } from './employees.service';
import { AdvancesService } from './advances.service';
import { GratuityService } from './gratuity.service';
import { LeaveService } from './leave.service';
import { maskIban } from './employee-mask';

export const NATIONAL_PENSION_FLAG = 'NATIONAL_PENSION_NOT_HANDLED';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** '2026-10' → 'October 2026'. */
export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const money = (n: number) => n.toFixed(2);
const iso = (d: Date | string | null | undefined) =>
  d ? new Date(d).toISOString() : null;
const byEmployeeNumber = (a: PayrollRunLine, b: PayrollRunLine) =>
  a.employeeNumber.localeCompare(b.employeeNumber);

/**
 * Reads a run `FOR UPDATE` inside the caller's transaction, so line edits,
 * refreshes, approval and void of one run serialise: none can commit between
 * another's status check and its write.
 */
export async function lockPayrollRun(
  manager: EntityManager,
  tenantId: string,
  id: string,
): Promise<PayrollRun> {
  const run = await manager
    .getRepository(PayrollRun)
    .createQueryBuilder('r')
    .setLock('pessimistic_write')
    .where('r.id = :id', { id })
    .andWhere('r.tenant_id = :tenantId', { tenantId })
    .getOne();
  if (!run) throw new NotFoundException('Payroll run not found');
  return run;
}

/** An employee who belongs on the run, with the package in force at month end. */
interface Eligible {
  employee: Employee;
  pkg: SalaryPackage;
  days: number;
}

function toLineDto(l: PayrollRunLine): PayrollRunLineDto {
  return {
    id: l.id,
    employeeId: l.employeeId,
    employeeName: l.employeeName,
    employeeNumber: l.employeeNumber,
    paymentMethod: l.paymentMethod,
    isNational: l.isNational,
    basic: l.basic,
    housing: l.housing,
    transport: l.transport,
    otherAllowances: l.otherAllowances ?? [],
    gross: l.gross,
    daysEmployed: l.daysEmployed,
    daysInMonth: l.daysInMonth,
    proratedGross: l.proratedGross,
    overtimeHours: l.overtimeHours,
    overtimeHoursPremium: l.overtimeHoursPremium,
    overtimeAmount: l.overtimeAmount,
    bonusAmount: l.bonusAmount,
    bonusLabel: l.bonusLabel,
    unpaidLeaveDays: l.unpaidLeaveDays,
    unpaidLeaveAmount: l.unpaidLeaveAmount,
    halfPayDays: l.halfPayDays ?? 0,
    halfPayAmount: l.halfPayAmount ?? 0,
    annualLeaveDays: l.annualLeaveDays ?? 0,
    leaveDaysInPeriod: l.leaveDaysInPeriod ?? 0,
    leaveOverridden: l.leaveOverridden ?? false,
    advanceRecovery: l.advanceRecovery,
    otherDeductionAmount: l.otherDeductionAmount,
    otherDeductionLabel: l.otherDeductionLabel,
    salaryCost: l.salaryCost,
    netPay: l.netPay,
    gratuityBefore: l.gratuityBefore,
    gratuityAccrual: l.gratuityAccrual,
    gratuityAfter: l.gratuityAfter,
    pensionSchemeName: l.pensionSchemeName ?? null,
    pensionBase: l.pensionBase ?? 0,
    pensionEmployee: l.pensionEmployee ?? 0,
    pensionEmployer: l.pensionEmployer ?? 0,
    leaveProvisionBefore: l.leaveProvisionBefore ?? null,
    leaveProvisionChange: l.leaveProvisionChange ?? null,
    leaveProvisionAfter: l.leaveProvisionAfter ?? null,
    flags: l.flags ?? [],
    paidAt: iso(l.paidAt),
  };
}

/**
 * A month's payroll while it is a draft: create, edit the monthly extras,
 * refresh from employees and packages. Amounts are always recomputed here;
 * nothing the client sends is trusted as a total.
 */
@Injectable()
export class PayrollRunsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly employees: EmployeesService,
    private readonly advances: AdvancesService,
    private readonly gratuity: GratuityService,
    private readonly leave: LeaveService,
  ) {}

  async create(
    tenantId: string,
    actorId: string,
    input: CreatePayrollRunPayload,
  ): Promise<PayrollRunDto> {
    const period = input.period;
    if (!PERIOD_PATTERN.test(period ?? '')) {
      throw new BadRequestException('Use a period like 2026-10');
    }
    const label = periodLabel(period);
    const { last } = periodBounds(period);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const runs = manager.getRepository(PayrollRun);
        const existing = (
          await runs.find({ where: { tenantId, period } })
        ).find((r) => r.status !== 'VOIDED');
        if (existing) {
          throw new ConflictException(
            `${label} already has payroll run ${existing.runNumber}`,
          );
        }
        const cutover = await this.gratuity.latestCutover(manager, tenantId);
        if (cutover && cutover >= last) {
          throw new ConflictException(
            `Gratuity opening balances were set up as of ${cutover}; payroll for ${label} is already in them`,
          );
        }

        const seq = await allocateNextSequenceValue(
          manager,
          tenantId,
          'payroll_run_number',
        );
        const run = await runs.save(
          runs.create({
            tenantId,
            runNumber: formatSequenceNumber('PR', seq),
            period,
            payDate: input.payDate ?? `${period}-28`,
            status: 'DRAFT',
            createdById: actorId,
          }),
        );

        const { eligible, warnings } = await this.eligible(
          manager,
          tenantId,
          period,
        );
        const lineRepo = manager.getRepository(PayrollRunLine);
        const lines = eligible.map((el) => {
          const line = lineRepo.create({
            tenantId,
            runId: run.id,
            employeeId: el.employee.id,
            overtimeHours: 0,
            overtimeHoursPremium: 0,
            bonusAmount: 0,
            bonusLabel: null,
            unpaidLeaveDays: 0,
            advanceRecovery: 0,
            otherDeductionAmount: 0,
            otherDeductionLabel: null,
            gratuityBefore: null,
            gratuityAccrual: null,
            gratuityAfter: null,
            halfPayDays: 0,
            halfPayAmount: 0,
            annualLeaveDays: 0,
            leaveDaysInPeriod: 0,
            leaveOverridden: false,
            pensionSchemeId: null,
            pensionSchemeName: null,
            pensionBase: 0,
            pensionEmployee: 0,
            pensionEmployer: 0,
            leaveProvisionBefore: null,
            leaveProvisionChange: null,
            leaveProvisionAfter: null,
            paidAt: null,
          });
          this.snapshot(line, el, period);
          this.recalcLine(line);
          return line;
        });
        const saved = lines.length ? await lineRepo.save(lines) : [];
        run.lines = saved;
        this.recalcTotals(run);
        await this.saveTotals(manager, run);
        return this.toDto(run, saved, warnings);
      });
    } catch (err) {
      // Two creates racing past the check: the partial unique index decides.
      if (
        err instanceof QueryFailedError &&
        (err.driverError as { code?: string })?.code === '23505'
      ) {
        throw new ConflictException(`${label} already has a payroll run`);
      }
      throw err;
    }
  }

  async list(tenantId: string): Promise<PayrollRunsListDto> {
    const manager = this.dataSource.manager;
    const runs = await manager.getRepository(PayrollRun).find({ where: { tenantId } });
    const openingGratuityCutover = await this.gratuity.latestCutover(manager, tenantId);
    const openingLeaveCutover = await this.leave.latestCutover(manager, tenantId);
    const sorted = runs
      .sort(
        (a, b) =>
          b.period.localeCompare(a.period) ||
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .map((r) => this.toDto(r));
    return { runs: sorted, openingGratuityCutover, openingLeaveCutover };
  }

  async get(tenantId: string, id: string): Promise<PayrollRunDto> {
    const manager = this.dataSource.manager;
    const run = await this.loadRun(manager, tenantId, id);
    const lines = await this.loadLines(manager, tenantId, run.id);
    return this.toDto(run, lines);
  }

  async updateLine(
    tenantId: string,
    runId: string,
    lineId: string,
    input: UpdatePayrollLinePayload,
  ): Promise<PayrollRunDto> {
    return this.dataSource.transaction(async (manager) => {
      const run = await this.lockRun(manager, tenantId, runId);
      this.assertDraft(run);
      const lineRepo = manager.getRepository(PayrollRunLine);
      const line = await lineRepo.findOne({
        where: { id: lineId, runId: run.id, tenantId },
      });
      if (!line) throw new NotFoundException('Payroll line not found');

      for (const [key, value] of Object.entries(input)) {
        if (value !== undefined)
          (line as unknown as Record<string, unknown>)[key] = value;
      }
      const name = line.employeeName;

      if (line.advanceRecovery > 0) {
        const outstanding = await this.advances.outstanding(
          manager,
          tenantId,
          line.employeeId,
          run.id,
        );
        if (line.advanceRecovery > outstanding) {
          throw new BadRequestException(
            `Only ${money(Math.max(0, outstanding))} of ${name}'s advance is outstanding`,
          );
        }
      }
      if (line.unpaidLeaveDays > line.daysEmployed) {
        throw new BadRequestException(
          `${name} was employed for only ${line.daysEmployed} days in ${periodLabel(run.period)}`,
        );
      }

      this.recalcLine(line);
      if (line.netPay < 0) {
        throw new BadRequestException(`${name}'s deductions exceed their pay`);
      }
      await lineRepo.save(line);

      const lines = await this.loadLines(manager, tenantId, run.id);
      run.lines = lines;
      this.recalcTotals(run);
      await this.saveTotals(manager, run);
      return this.toDto(run, lines);
    });
  }

  /**
   * Re-pulls packages and employment days, keeping the extras already entered;
   * adds newly eligible employees and drops those no longer eligible.
   */
  async refresh(tenantId: string, runId: string): Promise<PayrollRunDto> {
    return this.dataSource.transaction(async (manager) => {
      const run = await this.lockRun(manager, tenantId, runId);
      this.assertDraft(run);
      const lineRepo = manager.getRepository(PayrollRunLine);
      const current = await this.loadLines(manager, tenantId, run.id);
      const { eligible, warnings } = await this.eligible(
        manager,
        tenantId,
        run.period,
      );

      const byEmployee = new Map(current.map((l) => [l.employeeId, l]));
      const keep = new Set<string>();
      const toSave: PayrollRunLine[] = [];
      for (const el of eligible) {
        let line = byEmployee.get(el.employee.id);
        if (!line) {
          line = lineRepo.create({
            tenantId,
            runId: run.id,
            employeeId: el.employee.id,
            overtimeHours: 0,
            overtimeHoursPremium: 0,
            bonusAmount: 0,
            bonusLabel: null,
            unpaidLeaveDays: 0,
            advanceRecovery: 0,
            otherDeductionAmount: 0,
            otherDeductionLabel: null,
            gratuityBefore: null,
            gratuityAccrual: null,
            gratuityAfter: null,
            halfPayDays: 0,
            halfPayAmount: 0,
            annualLeaveDays: 0,
            leaveDaysInPeriod: 0,
            leaveOverridden: false,
            pensionSchemeId: null,
            pensionSchemeName: null,
            pensionBase: 0,
            pensionEmployee: 0,
            pensionEmployer: 0,
            leaveProvisionBefore: null,
            leaveProvisionChange: null,
            leaveProvisionAfter: null,
            paidAt: null,
          });
        }
        keep.add(el.employee.id);
        this.snapshot(line, el, run.period);
        this.recalcLine(line);
        // Fewer days or a smaller package can invalidate extras entered earlier;
        // say so rather than silently changing what was typed.
        if (line.unpaidLeaveDays > line.daysEmployed) {
          warnings.push(
            `${line.employeeName} has more unpaid leave days than days employed in ${periodLabel(run.period)}`,
          );
        } else if (line.netPay < 0) {
          warnings.push(`${line.employeeName}'s deductions exceed their pay`);
        }
        toSave.push(line);
      }

      const gone = current.filter((l) => !keep.has(l.employeeId));
      if (gone.length) await lineRepo.remove(gone);
      if (toSave.length) await lineRepo.save(toSave);

      const lines = await this.loadLines(manager, tenantId, run.id);
      run.lines = lines;
      this.recalcTotals(run);
      await this.saveTotals(manager, run);
      return this.toDto(run, lines, warnings);
    });
  }

  /**
   * Discards a draft: its lines and the run. A draft posted nothing, so there
   * is no journal or gratuity row to reverse.
   */
  async remove(tenantId: string, runId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const run = await this.lockRun(manager, tenantId, runId);
      if (run.status !== 'DRAFT') {
        throw new ConflictException(
          `Payroll run ${run.runNumber} is ${run.status.toLowerCase().replace(/_/g, ' ')}; only a draft can be deleted`,
        );
      }
      await manager
        .getRepository(PayrollRunLine)
        .delete({ tenantId, runId: run.id });
      await manager
        .getRepository(PayrollRun)
        .delete({ id: run.id, tenantId });
    });
  }

  async payslip(
    tenantId: string,
    runId: string,
    lineId: string,
  ): Promise<PayslipDto> {
    const manager = this.dataSource.manager;
    const run = await this.loadRun(manager, tenantId, runId);
    const line = await manager
      .getRepository(PayrollRunLine)
      .findOne({ where: { id: lineId, runId: run.id, tenantId } });
    if (!line) throw new NotFoundException('Payroll line not found');
    // Soft-deleted employees keep their payslips.
    const employee = await manager.getRepository(Employee).findOne({
      where: { id: line.employeeId, tenantId },
      withDeleted: true,
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const org = await manager
      .getRepository(Organization)
      .findOne({ where: { id: tenantId } });
    if (!org) throw new NotFoundException('Organization not found');

    const address =
      [
        org.addressLine1,
        org.addressLine2,
        org.city,
        org.region,
        org.postalCode,
        org.country,
      ]
        .filter(Boolean)
        .join(', ') || null;

    return {
      run: {
        id: run.id,
        runNumber: run.runNumber,
        period: run.period,
        payDate: run.payDate,
        status: run.status,
      },
      line: toLineDto(line),
      employee: {
        id: employee.id,
        employeeNumber: employee.employeeNumber,
        fullName: `${employee.firstName} ${employee.lastName}`,
        jobTitle: employee.jobTitle,
        department: employee.department,
        joiningDate: employee.joiningDate,
        paymentMethod: employee.paymentMethod,
        bankName: employee.bankName,
        // Only the last four digits ever leave the server on a payslip.
        ibanMasked: maskIban(employee.ibanLast4),
      },
      organization: {
        name: org.name,
        legalName: org.legalName,
        address,
        baseCurrency: org.baseCurrency,
      },
    };
  }

  /**
   * Leave days on the line from the employee's records. A line whose leave
   * someone edited by hand keeps its unpaid and half-pay days; the
   * informational counts always follow the records.
   */
  async fillLeave(
    manager: EntityManager,
    line: PayrollRunLine,
    employee: Employee,
    period: string,
  ): Promise<void> {
    const pl = await this.leave.periodLeave(
      manager,
      employee.tenantId,
      employee,
      period,
    );
    if (!line.leaveOverridden) {
      line.unpaidLeaveDays = pl.unpaidDays;
      line.halfPayDays = pl.halfPayDays;
    }
    line.annualLeaveDays = pl.annualDays;
    line.leaveDaysInPeriod = pl.leaveDays;
  }

  /**
   * After a leave record changes: re-fills the employee's line on each DRAFT
   * run among `periods` and moves the run totals, so nobody approves stale
   * leave. Posted runs are not touched (record changes in their months are
   * refused before this is called). Writes only the line columns leave moves.
   */
  async refillLeaveForEmployee(
    manager: EntityManager,
    tenantId: string,
    employeeId: string,
    periods: string[],
  ): Promise<void> {
    const wanted = new Set(periods);
    if (!wanted.size) return;
    const drafts = (
      await manager.getRepository(PayrollRun).find({ where: { tenantId } })
    )
      .filter((r) => r.status === 'DRAFT' && wanted.has(r.period))
      .sort((a, b) => a.period.localeCompare(b.period));
    if (!drafts.length) return;
    // A soft-deleted employee can still have a draft line.
    const employee = await manager.getRepository(Employee).findOne({
      where: { id: employeeId, tenantId },
      withDeleted: true,
    });
    if (!employee) return;

    const lineRepo = manager.getRepository(PayrollRunLine);
    for (const draft of drafts) {
      const run = await this.lockRun(manager, tenantId, draft.id);
      if (run.status !== 'DRAFT') continue;
      const lines = await this.loadLines(manager, tenantId, run.id);
      const line = lines.find((l) => l.employeeId === employeeId);
      if (!line) continue;
      await this.fillLeave(manager, line, employee, run.period);
      this.recalcLine(line);
      await lineRepo.update(
        { id: line.id, tenantId },
        {
          unpaidLeaveDays: line.unpaidLeaveDays,
          halfPayDays: line.halfPayDays,
          annualLeaveDays: line.annualLeaveDays,
          leaveDaysInPeriod: line.leaveDaysInPeriod,
          proratedGross: line.proratedGross,
          overtimeAmount: line.overtimeAmount,
          unpaidLeaveAmount: line.unpaidLeaveAmount,
          halfPayAmount: line.halfPayAmount,
          salaryCost: line.salaryCost,
          netPay: line.netPay,
        },
      );
      run.lines = lines;
      this.recalcTotals(run);
      await this.saveTotals(manager, run);
    }
  }

  /** Amounts from the snapshot and extras. */
  recalcLine(line: PayrollRunLine): void {
    const got = computeLine({
      gross: line.gross,
      basic: line.basic,
      daysEmployed: line.daysEmployed,
      daysInMonth: line.daysInMonth,
      overtimeHours: line.overtimeHours,
      overtimeHoursPremium: line.overtimeHoursPremium,
      bonusAmount: line.bonusAmount,
      unpaidLeaveDays: line.unpaidLeaveDays,
      advanceRecovery: line.advanceRecovery,
      otherDeductionAmount: line.otherDeductionAmount,
      halfPayDays: line.halfPayDays ?? 0,
      pensionEmployee: line.pensionEmployee ?? 0,
    });
    line.proratedGross = got.proratedGross;
    line.overtimeAmount = got.overtimeAmount;
    line.unpaidLeaveAmount = got.unpaidLeaveAmount;
    line.halfPayAmount = got.halfPayAmount;
    line.salaryCost = got.salaryCost;
    line.netPay = got.netPay;
  }

  /** Run totals from `run.lines`. */
  recalcTotals(run: PayrollRun): void {
    const lines = run.lines ?? [];
    const sum = (f: (l: PayrollRunLine) => number) =>
      round2(lines.reduce((s, l) => s + f(l), 0));
    run.totalSalaryCost = sum((l) => l.salaryCost);
    run.totalOvertime = sum((l) => l.overtimeAmount);
    run.totalBonus = sum((l) => l.bonusAmount);
    run.totalUnpaidLeave = sum((l) => l.unpaidLeaveAmount);
    run.totalAdvanceRecovery = sum((l) => l.advanceRecovery);
    run.totalOtherDeductions = sum((l) => l.otherDeductionAmount);
    run.totalNet = sum((l) => l.netPay);
    run.totalGratuityAccrual = sum((l) => l.gratuityAccrual ?? 0);
    run.totalHalfPay = sum((l) => l.halfPayAmount ?? 0);
    run.totalPensionEmployee = sum((l) => l.pensionEmployee ?? 0);
    run.totalPensionEmployer = sum((l) => l.pensionEmployer ?? 0);
    run.totalLeaveProvision = sum((l) => l.leaveProvisionChange ?? 0);
  }

  toDto(
    run: PayrollRun,
    lines?: PayrollRunLine[],
    warnings?: string[],
  ): PayrollRunDto {
    const sorted = lines ? [...lines].sort(byEmployeeNumber) : undefined;
    const netBy = (method: 'BANK' | 'CASH') =>
      round2(
        (sorted ?? [])
          .filter((l) => l.paymentMethod === method)
          .reduce((s, l) => s + l.netPay, 0),
      );
    const dto: PayrollRunDto = {
      id: run.id,
      runNumber: run.runNumber,
      period: run.period,
      payDate: run.payDate,
      status: run.status,
      totals: {
        salaryCost: run.totalSalaryCost ?? 0,
        overtime: run.totalOvertime ?? 0,
        bonus: run.totalBonus ?? 0,
        unpaidLeave: run.totalUnpaidLeave ?? 0,
        advanceRecovery: run.totalAdvanceRecovery ?? 0,
        otherDeductions: run.totalOtherDeductions ?? 0,
        net: run.totalNet ?? 0,
        gratuityAccrual: run.totalGratuityAccrual ?? 0,
        halfPay: run.totalHalfPay ?? 0,
        pensionEmployee: run.totalPensionEmployee ?? 0,
        pensionEmployer: run.totalPensionEmployer ?? 0,
        leaveProvision: run.totalLeaveProvision ?? 0,
        bankNet: netBy('BANK'),
        cashNet: netBy('CASH'),
      },
      bankPaidAt: iso(run.bankPaidAt),
      cashPaidAt: iso(run.cashPaidAt),
      approvedAt: iso(run.approvedAt),
      approvedById: run.approvedById ?? null,
      journalEntryId: run.journalEntryId ?? null,
      createdAt: iso(run.createdAt) ?? '',
      updatedAt: iso(run.updatedAt) ?? '',
    };
    if (sorted) dto.lines = sorted.map(toLineDto);
    if (warnings) dto.warnings = warnings;
    return dto;
  }

  // ─── internals ───────────────────────────────────────────────────────────

  /**
   * Employees with days in the period — ACTIVE ones, and LEFT ones whose
   * leaving date falls in it (their final month and last gratuity true-up) —
   * each with the package in force on the last day of the month. No package
   * → skipped with a warning.
   */
  private async eligible(
    manager: EntityManager,
    tenantId: string,
    period: string,
  ): Promise<{ eligible: Eligible[]; warnings: string[] }> {
    const { last } = periodBounds(period);
    const label = periodLabel(period);
    const rows = (
      await manager.getRepository(Employee).find({ where: { tenantId } })
    ).filter(
      (e) =>
        e.status === 'ACTIVE' || (e.status === 'LEFT' && !!e.leavingDate),
    );
    rows.sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber));
    const eligible: Eligible[] = [];
    const warnings: string[] = [];
    for (const employee of rows) {
      const days = daysEmployed({
        period,
        joiningDate: employee.joiningDate,
        leavingDate: employee.leavingDate,
      });
      if (days <= 0) continue;
      const pkg = await this.employees.packageAt(
        manager,
        tenantId,
        employee.id,
        last,
      );
      if (!pkg) {
        warnings.push(
          `${employee.employeeNumber} has no salary package for ${label}`,
        );
        continue;
      }
      eligible.push({ employee, pkg, days });
    }
    return { eligible, warnings };
  }

  private snapshot(line: PayrollRunLine, el: Eligible, period: string): void {
    const { employee: e, pkg, days } = el;
    line.employeeName = `${e.firstName} ${e.lastName}`;
    line.employeeNumber = e.employeeNumber;
    line.paymentMethod = e.paymentMethod;
    line.isNational = e.isNational;
    line.packageId = pkg.id;
    line.basic = pkg.basic;
    line.housing = pkg.housing;
    line.transport = pkg.transport;
    line.otherAllowances = pkg.otherAllowances ?? [];
    line.gross = packageGross({
      basic: pkg.basic,
      housing: pkg.housing,
      transport: pkg.transport,
      otherAllowances: pkg.otherAllowances ?? [],
    });
    line.daysEmployed = days;
    line.daysInMonth = periodBounds(period).daysInMonth;
    line.flags = e.isNational ? [NATIONAL_PENSION_FLAG] : [];
  }

  private assertDraft(run: PayrollRun): void {
    if (run.status !== 'DRAFT') {
      throw new ConflictException(
        `Payroll run ${run.runNumber} is ${run.status.toLowerCase().replace('_', ' ')} and can no longer be edited`,
      );
    }
  }

  private async loadRun(
    manager: EntityManager,
    tenantId: string,
    id: string,
  ): Promise<PayrollRun> {
    const run = await manager
      .getRepository(PayrollRun)
      .findOne({ where: { id, tenantId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    return run;
  }

  private async loadLines(
    manager: EntityManager,
    tenantId: string,
    runId: string,
  ): Promise<PayrollRunLine[]> {
    const lines = await manager
      .getRepository(PayrollRunLine)
      .find({ where: { tenantId, runId } });
    return lines.sort(byEmployeeNumber);
  }

  private lockRun(
    manager: EntityManager,
    tenantId: string,
    id: string,
  ): Promise<PayrollRun> {
    return lockPayrollRun(manager, tenantId, id);
  }

  /**
   * Writes only the total columns: the run row is never rewritten from the
   * state this request read, so status and approval fields stay whoever set them.
   */
  private async saveTotals(
    manager: EntityManager,
    run: PayrollRun,
  ): Promise<void> {
    await manager.getRepository(PayrollRun).update(
      { id: run.id, tenantId: run.tenantId },
      {
        totalSalaryCost: run.totalSalaryCost,
        totalOvertime: run.totalOvertime,
        totalBonus: run.totalBonus,
        totalUnpaidLeave: run.totalUnpaidLeave,
        totalAdvanceRecovery: run.totalAdvanceRecovery,
        totalOtherDeductions: run.totalOtherDeductions,
        totalNet: run.totalNet,
        totalGratuityAccrual: run.totalGratuityAccrual,
        totalHalfPay: run.totalHalfPay,
        totalPensionEmployee: run.totalPensionEmployee,
        totalPensionEmployer: run.totalPensionEmployer,
        totalLeaveProvision: run.totalLeaveProvision,
      },
    );
    // update() bumps updated_at in the database; mirror it for the response.
    run.updatedAt = new Date();
  }
}
