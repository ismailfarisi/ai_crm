import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import {
  LEDGER_ROLES,
  PERMISSIONS,
  leaveAccrued,
  leaveForPeriod,
  leaveServiceDays,
  round2,
  type EmployeeLeaveDto,
  type JournalLineInput,
  type LeaveAdjustmentPayload,
  type LeaveLedgerEntryDto,
  type LeaveRecordDto,
  type OpeningLeavePreviewDto,
  type PeriodLeave,
  type PostOpeningLeavePayload,
} from '@saas/shared';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { LedgerService } from '../finance/ledger.service';
import { baseCurrencyFor } from '../finance/fx';
import { Settlement } from './entities/settlement.entity';
import { EmployeesService } from './employees.service';
import { Employee } from './entities/employee.entity';
import { LeaveRecord } from './entities/leave-record.entity';
import { LeaveLedgerEntry } from './entities/leave-ledger-entry.entity';
import { GratuityService, lockGratuityOpening } from './gratuity.service';
import { PayrollSettingsService } from './payroll-settings.service';

const today = () => new Date().toISOString().slice(0, 10);
const dayToDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
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
    private readonly ledger: LedgerService,
    private readonly employees: EmployeesService,
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

  /**
   * Employees who can be given an opening leave balance at `cutover`: not
   * left, joined by then, no OPENING row yet and no ACCRUAL from a run that is
   * still posted. Runs from before leave tracking carry no leave rows, so
   * they do not block.
   */
  private async eligibleForOpening(
    manager: EntityManager,
    tenantId: string,
    cutover: string,
  ): Promise<Employee[]> {
    const { opened, accrued } = await this.openingState(manager, tenantId);
    const rows = await manager.getRepository(Employee).find({ where: { tenantId } });
    return rows
      .filter(
        (e) =>
          e.status !== 'LEFT' &&
          e.joiningDate <= cutover &&
          !opened.has(e.id) &&
          !accrued.has(e.id),
      )
      .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber));
  }

  private async openingState(
    manager: EntityManager,
    tenantId: string,
  ): Promise<{ opened: Set<string>; accrued: Set<string> }> {
    const rows = await manager.getRepository(LeaveLedgerEntry).find({ where: { tenantId } });
    const reversed = new Set(
      rows.filter((r) => r.kind === 'REVERSAL' && r.runLineId).map((r) => r.runLineId),
    );
    return {
      opened: new Set(rows.filter((r) => r.kind === 'OPENING').map((r) => r.employeeId)),
      accrued: new Set(
        rows
          .filter((r) => r.kind === 'ACCRUAL' && !(r.runLineId && reversed.has(r.runLineId)))
          .map((r) => r.employeeId),
      ),
    };
  }

  private async defaultCutover(manager: EntityManager, tenantId: string): Promise<string> {
    const existing = await this.gratuity.latestCutover(manager, tenantId);
    if (existing) return existing;
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
      .toISOString()
      .slice(0, 10);
  }

  async previewOpening(tenantId: string, cutoverDate?: string): Promise<OpeningLeavePreviewDto> {
    const manager = this.dataSource.manager;
    const cutover = cutoverDate ?? (await this.defaultCutover(manager, tenantId));
    const eligible = await this.eligibleForOpening(manager, tenantId, cutover);
    const lines: OpeningLeavePreviewDto['lines'] = [];
    for (const e of eligible) {
      const got = await this.accruedTo(manager, tenantId, e, cutover);
      const pkg = await this.employees.packageAt(manager, tenantId, e.id, cutover);
      lines.push({
        employeeId: e.id,
        employeeName: `${e.firstName} ${e.lastName}`,
        joiningDate: e.joiningDate,
        basic: pkg?.basic ?? 0,
        serviceDays: got.serviceDays,
        calculatedDays: got.accrued,
      });
    }
    return { cutoverDate: cutover, lines };
  }

  /**
   * Books the leave provision employees had already earned at go-live:
   * Dr opening balance equity / Cr leave provision for Σ balance × basic ÷ 30,
   * an OPENING row per employee at the statutory days, and an ADJUSTMENT for
   * the difference when the real balance (leave taken before go-live) differs.
   */
  async postOpening(
    tenantId: string,
    actorId: string,
    input: PostOpeningLeavePayload,
    permissions: readonly string[],
  ): Promise<{ journalEntryId: string | null; total: number }> {
    void actorId; // the audit trail records who
    this.assertCanApprove(permissions);
    return this.dataSource.transaction(async (manager) => {
      await lockGratuityOpening(manager, tenantId);
      const cutover = input.cutoverDate;

      const ids = input.lines.map((l) => l.employeeId);
      if (new Set(ids).size !== ids.length) {
        throw new BadRequestException('Each employee can appear only once');
      }
      const { opened, accrued } = await this.openingState(manager, tenantId);
      const employees = new Map<string, Employee>();
      const alreadyAccrued: string[] = [];
      for (const id of ids) {
        const e = await manager.getRepository(Employee).findOne({ where: { id, tenantId } });
        if (!e || e.status === 'LEFT' || e.joiningDate > cutover) {
          throw new BadRequestException(
            `${e ? `${e.firstName} ${e.lastName}` : 'An employee'} does not qualify for an opening leave balance at ${cutover}`,
          );
        }
        if (opened.has(id)) {
          throw new ConflictException(
            `${e.firstName} ${e.lastName} already has an opening leave balance`,
          );
        }
        if (accrued.has(id)) alreadyAccrued.push(`${e.firstName} ${e.lastName}`);
        employees.set(id, e);
      }
      if (alreadyAccrued.length) {
        throw new ConflictException(
          `Leave already accrued by a posted payroll run for ${alreadyAccrued.join(', ')}`,
        );
      }

      const planned: { employeeId: string; calculated: number; balance: number; amount: number }[] =
        [];
      for (const l of input.lines) {
        const employee = employees.get(l.employeeId)!;
        const calculated = (await this.accruedTo(manager, tenantId, employee, cutover)).accrued;
        const pkg = await this.employees.packageAt(manager, tenantId, employee.id, cutover);
        planned.push({
          employeeId: l.employeeId,
          calculated,
          balance: l.balanceDays,
          amount: round2((l.balanceDays * (pkg?.basic ?? 0)) / 30),
        });
      }

      const total = round2(planned.reduce((s, p) => s + p.amount, 0));
      let journalEntryId: string | null = null;
      if (total !== 0) {
        const entry = await this.postProvision(manager, tenantId, {
          amount: total,
          entryNumber: `JE-LEAVE-OPEN-${cutover}-${randomUUID().slice(0, 8)}`,
          referenceId: `leave-opening:${cutover}`,
          entryDate: dayToDate(cutover),
          description: `Leave salary provision at go-live (${cutover})`,
        });
        journalEntryId = entry.id;
      }

      const repo = manager.getRepository(LeaveLedgerEntry);
      const rows: LeaveLedgerEntry[] = [];
      for (const p of planned) {
        rows.push(
          repo.create({
            tenantId,
            employeeId: p.employeeId,
            kind: 'OPENING',
            days: p.calculated,
            amount: p.amount,
            asOf: cutover,
            runLineId: null,
            settlementId: null,
            journalEntryId,
            note: null,
          }),
        );
        const diff = round2(p.balance - p.calculated);
        if (diff !== 0) {
          rows.push(
            repo.create({
              tenantId,
              employeeId: p.employeeId,
              kind: 'ADJUSTMENT',
              days: diff,
              amount: null,
              asOf: cutover,
              runLineId: null,
              settlementId: null,
              journalEntryId,
              note: 'Opening balance: leave taken before go-live',
            }),
          );
        }
      }
      await repo.save(rows);
      return { journalEntryId, total };
    });
  }

  /**
   * A days-only correction. No journal: the next approval trues the
   * provision up to the balance.
   */
  async adjust(
    tenantId: string,
    employeeId: string,
    actorId: string,
    input: LeaveAdjustmentPayload,
    permissions: readonly string[],
  ): Promise<LeaveLedgerEntryDto> {
    void actorId; // the audit trail records who
    this.assertCanApprove(permissions);
    return this.dataSource.transaction(async (manager) => {
      const employee = await manager
        .getRepository(Employee)
        .findOne({ where: { id: employeeId, tenantId } });
      if (!employee) throw new NotFoundException('Employee not found');
      const settlements = await manager
        .getRepository(Settlement)
        .find({ where: { tenantId, employeeId } });
      if (settlements.some((s) => s.status === 'APPROVED' || s.status === 'PAID')) {
        throw new ConflictException(`${employee.firstName} ${employee.lastName} is settled`);
      }
      const repo = manager.getRepository(LeaveLedgerEntry);
      const saved = await repo.save(
        repo.create({
          tenantId,
          employeeId,
          kind: 'ADJUSTMENT',
          days: round2(input.days),
          amount: null,
          asOf: today(),
          runLineId: null,
          settlementId: null,
          journalEntryId: null,
          note: input.note,
        }),
      );
      return toEntryDto(saved, false);
    });
  }

  private assertCanApprove(permissions: readonly string[]): void {
    if (!permissions.includes(PERMISSIONS.PAYROLL_APPROVE)) {
      throw new ForbiddenException('You do not have permission to change leave balances.');
    }
  }

  /** Signed movement in the leave provision against opening balance equity. */
  private async postProvision(
    manager: EntityManager,
    tenantId: string,
    p: {
      amount: number;
      entryNumber: string;
      referenceId: string;
      entryDate: Date;
      description: string;
    },
  ): Promise<JournalEntry> {
    const abs = round2(Math.abs(p.amount));
    const equity: JournalLineInput = {
      role: LEDGER_ROLES.OPENING_BALANCE_EQUITY,
      accountName: 'Opening balance equity',
      debit: 0,
      credit: 0,
      description: p.description,
    };
    const provision: JournalLineInput = {
      role: LEDGER_ROLES.LEAVE_PROVISION,
      accountName: 'Leave salary provision',
      debit: 0,
      credit: 0,
      description: p.description,
    };
    const input =
      p.amount > 0
        ? [
            { ...equity, debit: abs },
            { ...provision, credit: abs },
          ]
        : [
            { ...provision, debit: abs },
            { ...equity, credit: abs },
          ];
    const lines = await this.ledger.resolveLines(tenantId, input, manager);
    const repo = manager.getRepository(JournalEntry);
    return repo.save(
      repo.create({
        tenantId,
        entryNumber: p.entryNumber,
        referenceType: 'PAYROLL',
        referenceId: p.referenceId,
        entryDate: p.entryDate,
        totalAmount: abs,
        currency: await baseCurrencyFor(manager, tenantId),
        fxRate: 1,
        lines,
      }),
    );
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
