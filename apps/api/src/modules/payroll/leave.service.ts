import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import {
  leaveAccrued,
  leaveForPeriod,
  leaveServiceDays,
  round2,
  type EmployeeLeaveDto,
  type LeaveLedgerEntryDto,
  type LeaveRecordDto,
  type PeriodLeave,
} from '@saas/shared';
import { Employee } from './entities/employee.entity';
import { LeaveRecord } from './entities/leave-record.entity';
import { LeaveLedgerEntry } from './entities/leave-ledger-entry.entity';
import { GratuityService } from './gratuity.service';
import { PayrollSettingsService } from './payroll-settings.service';

const today = () => new Date().toISOString().slice(0, 10);
const iso = (d: Date | string) => new Date(d).toISOString();

export function toLeaveRecordDto(r: LeaveRecord): LeaveRecordDto {
  return {
    id: r.id,
    employeeId: r.employeeId,
    type: r.type,
    startDate: r.startDate,
    endDate: r.endDate,
    days: r.days,
    note: r.note ?? null,
    createdAt: iso(r.createdAt),
  };
}

function toEntryDto(r: LeaveLedgerEntry, canSeePay: boolean): LeaveLedgerEntryDto {
  return {
    id: r.id,
    kind: r.kind,
    days: r.days,
    amount: canSeePay ? r.amount : null,
    asOf: r.asOf,
    note: r.note,
    createdAt: iso(r.createdAt),
  };
}

/**
 * Reads an employee's leave: records, what they mean for a month's pay, the
 * days ledger and the statutory accrual. Writes live elsewhere
 * (LeaveRecordsService, approval), so this has no dependency on runs.
 */
@Injectable()
export class LeaveService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly gratuity: GratuityService,
    private readonly settings: PayrollSettingsService,
  ) {}

  /** The employee's leave records, earliest first. */
  async records(
    manager: EntityManager,
    tenantId: string,
    employeeId: string,
  ): Promise<LeaveRecord[]> {
    const rows = await manager
      .getRepository(LeaveRecord)
      .find({ where: { tenantId, employeeId } });
    return rows.sort(
      (a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate),
    );
  }

  /** What the employee's records mean for `period`'s pay. */
  async periodLeave(
    manager: EntityManager,
    tenantId: string,
    employee: Employee,
    period: string,
  ): Promise<PeriodLeave> {
    const records = await this.records(manager, tenantId, employee.id);
    return leaveForPeriod({
      records: records.map((r) => ({
        type: r.type,
        startDate: r.startDate,
        endDate: r.endDate,
        days: r.days,
      })),
      joiningDate: employee.joiningDate,
      probationEndDate: employee.probationEndDate ?? null,
      leavingDate: employee.leavingDate ?? null,
      period,
    });
  }

  /** Leave balance in days: Σ days of every ledger row. */
  async balanceDays(
    manager: EntityManager,
    tenantId: string,
    employeeId: string,
  ): Promise<number> {
    const rows = await this.ledgerRows(manager, tenantId, employeeId);
    return round2(rows.reduce((s, r) => s + r.days, 0));
  }

  /** The leave salary provision carried for the employee (2410): Σ amount. */
  async provisionBalance(
    manager: EntityManager,
    tenantId: string,
    employeeId: string,
  ): Promise<number> {
    const rows = await this.ledgerRows(manager, tenantId, employeeId);
    return round2(rows.reduce((s, r) => s + (r.amount ?? 0), 0));
  }

  /**
   * Days already accrued through the ledger: OPENING rows plus ACCRUAL rows
   * still posted (an ACCRUAL whose run line has a REVERSAL belongs to a
   * voided run). The next accrual is the statutory figure less this.
   */
  async accrualBaseline(
    manager: EntityManager,
    tenantId: string,
    employeeId: string,
  ): Promise<number> {
    const rows = await this.ledgerRows(manager, tenantId, employeeId);
    const reversed = new Set(
      rows.filter((r) => r.kind === 'REVERSAL' && r.runLineId).map((r) => r.runLineId),
    );
    const days = rows
      .filter(
        (r) =>
          r.kind === 'OPENING' ||
          (r.kind === 'ACCRUAL' && !(r.runLineId && reversed.has(r.runLineId))),
      )
      .reduce((s, r) => s + r.days, 0);
    return round2(days);
  }

  /**
   * Statutory leave earned by `asOf` (callers pass a month end). Service stops
   * at the leaving date; unpaid days are counted to `asOf` itself, as gratuity
   * counts them, so a leaver's final-month unpaid leave still reduces service.
   */
  async accruedTo(
    manager: EntityManager,
    tenantId: string,
    employee: Employee,
    asOf: string,
    extraUnpaidDays = 0,
  ): Promise<{ serviceDays: number; accrued: number; annualDays: number }> {
    const day =
      employee.leavingDate && employee.leavingDate < asOf ? employee.leavingDate : asOf;
    const unpaidDays = await this.gratuity.unpaidLeaveDaysTo(
      manager,
      tenantId,
      employee.id,
      asOf,
      extraUnpaidDays,
    );
    const annualDays = await this.settings.annualDaysFor(manager, tenantId, employee);
    const serviceDays = leaveServiceDays({
      joiningDate: employee.joiningDate,
      asOf: day,
      unpaidDays,
    });
    return { serviceDays, accrued: leaveAccrued({ serviceDays, annualDays }), annualDays };
  }

  /** The leave go-live cut-over: the latest leave OPENING `asOf`, or null. */
  async latestCutover(manager: EntityManager, tenantId: string): Promise<string | null> {
    const rows = await manager
      .getRepository(LeaveLedgerEntry)
      .find({ where: { tenantId, kind: 'OPENING' } });
    let max: string | null = null;
    for (const r of rows) if (!max || r.asOf > max) max = r.asOf;
    return max;
  }

  /**
   * Balance, records and ledger for the employee page. Provision amounts are
   * pay data: without `canSeePay` the provision is omitted and every entry's
   * amount is null.
   */
  async summary(
    tenantId: string,
    employeeId: string,
    canSeePay: boolean,
  ): Promise<EmployeeLeaveDto> {
    const manager = this.dataSource.manager;
    const employee = await manager
      .getRepository(Employee)
      .findOne({ where: { id: employeeId, tenantId } });
    if (!employee) throw new NotFoundException('Employee not found');

    const rows = await this.ledgerRows(manager, tenantId, employeeId);
    const records = await this.records(manager, tenantId, employeeId);
    const accrued = await this.accruedTo(manager, tenantId, employee, today());
    const dto: EmployeeLeaveDto = {
      balanceDays: round2(rows.reduce((s, r) => s + r.days, 0)),
      accruedToDate: accrued.accrued,
      annualDays: accrued.annualDays,
      records: records.reverse().map(toLeaveRecordDto),
      entries: [...rows]
        .sort(
          (a, b) =>
            b.asOf.localeCompare(a.asOf) ||
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
        .map((r) => toEntryDto(r, canSeePay)),
    };
    if (canSeePay) dto.provision = round2(rows.reduce((s, r) => s + (r.amount ?? 0), 0));
    return dto;
  }

  private ledgerRows(
    manager: EntityManager,
    tenantId: string,
    employeeId: string,
  ): Promise<LeaveLedgerEntry[]> {
    return manager
      .getRepository(LeaveLedgerEntry)
      .find({ where: { tenantId, employeeId } });
  }
}
