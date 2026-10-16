import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import {
  recordPeriods,
  sickDaysByServiceYear,
  type LeaveRecordDto,
  type LeaveRecordPayload,
} from '@saas/shared';
import { Employee } from './entities/employee.entity';
import { PayrollRun } from './entities/payroll-run.entity';
import { LeaveRecord } from './entities/leave-record.entity';
import { Settlement } from './entities/settlement.entity';
import { postedRunLines } from './advances.service';
import { lockGratuityOpening } from './gratuity.service';
import { LeaveService, toLeaveRecordDto } from './leave.service';
import { lockPayrollRun, PayrollRunsService, periodLabel } from './payroll-runs.service';

const MAX_SICK_DAYS_PER_SERVICE_YEAR = 90;

interface Range {
  type: LeaveRecord['type'];
  startDate: string;
  endDate: string;
  days: number;
}

const fullName = (e: Employee) => `${e.firstName} ${e.lastName}`;
const typeLabel = (t: LeaveRecord['type']) => t.toLowerCase().replace('_', ' ');

/**
 * HR's leave records for an employee. Every change is one transaction that
 * refuses months already posted, overlaps and sick leave past the statutory
 * 90 days, then re-fills any draft run the change touches.
 */
@Injectable()
export class LeaveRecordsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly leave: LeaveService,
    private readonly runs: PayrollRunsService,
  ) {}

  async create(
    tenantId: string,
    employeeId: string,
    actorId: string,
    input: LeaveRecordPayload,
  ): Promise<LeaveRecordDto> {
    return this.dataSource.transaction(async (manager) => {
      const periods = recordPeriods(input);
      await this.lock(manager, tenantId, periods);
      const employee = await this.loadEmployee(manager, tenantId, employeeId);
      await this.assertCanChange(manager, employee, null, input, periods);

      const repo = manager.getRepository(LeaveRecord);
      const saved = await repo.save(
        repo.create({
          tenantId,
          employeeId,
          type: input.type,
          startDate: input.startDate,
          endDate: input.endDate,
          days: input.days,
          note: input.note ?? null,
          createdById: actorId,
        }),
      );
      await this.runs.refillLeaveForEmployee(manager, tenantId, employeeId, periods);
      return toLeaveRecordDto(saved);
    });
  }

  async update(
    tenantId: string,
    employeeId: string,
    recordId: string,
    input: LeaveRecordPayload,
  ): Promise<LeaveRecordDto> {
    return this.dataSource.transaction(async (manager) => {
      const seen = await this.loadRecord(manager, tenantId, employeeId, recordId);
      const periods = this.union(recordPeriods(seen), recordPeriods(input));
      await this.lock(manager, tenantId, periods);
      const current = await this.reload(manager, tenantId, employeeId, seen);
      const employee = await this.loadEmployee(manager, tenantId, employeeId);
      await this.assertCanChange(manager, employee, current, input, periods);

      const repo = manager.getRepository(LeaveRecord);
      await repo.update(
        { id: recordId, tenantId },
        {
          type: input.type,
          startDate: input.startDate,
          endDate: input.endDate,
          days: input.days,
          note: input.note ?? null,
        },
      );
      await this.runs.refillLeaveForEmployee(manager, tenantId, employeeId, periods);
      const saved = await this.loadRecord(manager, tenantId, employeeId, recordId);
      return toLeaveRecordDto(saved);
    });
  }

  async remove(tenantId: string, employeeId: string, recordId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const seen = await this.loadRecord(manager, tenantId, employeeId, recordId);
      const periods = recordPeriods(seen);
      await this.lock(manager, tenantId, periods);
      await this.reload(manager, tenantId, employeeId, seen);
      const employee = await this.loadEmployee(manager, tenantId, employeeId);
      await this.assertSettled(manager, employee);
      await this.assertNotPosted(manager, employee, periods);

      await manager.getRepository(LeaveRecord).delete({ id: recordId, tenantId });
      await this.runs.refillLeaveForEmployee(manager, tenantId, employeeId, periods);
    });
  }

  // ─── internals ───────────────────────────────────────────────────────────

  /**
   * Locks the DRAFT runs of the affected months, then the tenant's payroll
   * advisory lock — the order approval takes them in (run row, then
   * advisory), so the two cannot deadlock. Once both are held, no approval or
   * void can be part-way through, and leave writers for the tenant queue here.
   */
  private async lock(manager: EntityManager, tenantId: string, periods: string[]): Promise<void> {
    const wanted = new Set(periods);
    const drafts = (await manager.getRepository(PayrollRun).find({ where: { tenantId } }))
      .filter((r) => r.status === 'DRAFT' && wanted.has(r.period))
      .sort((a, b) => a.period.localeCompare(b.period));
    for (const r of drafts) await lockPayrollRun(manager, tenantId, r.id);
    await lockGratuityOpening(manager, tenantId);
  }

  /**
   * The record as it stands once the locks are held. If another writer moved
   * it in the meantime, the months locked may be the wrong ones: refuse
   * rather than write against them.
   */
  private async reload(
    manager: EntityManager,
    tenantId: string,
    employeeId: string,
    seen: LeaveRecord,
  ): Promise<LeaveRecord> {
    const current = await this.loadRecord(manager, tenantId, employeeId, seen.id);
    if (current.startDate !== seen.startDate || current.endDate !== seen.endDate) {
      throw new ConflictException('This leave record was changed by someone else; reload and try again');
    }
    return current;
  }

  private async assertCanChange(
    manager: EntityManager,
    employee: Employee,
    current: LeaveRecord | null,
    next: Range,
    periods: string[],
  ): Promise<void> {
    if (next.startDate < employee.joiningDate) {
      throw new BadRequestException(
        `${fullName(employee)} joined on ${employee.joiningDate}; leave cannot start before that`,
      );
    }
    if (employee.leavingDate && next.endDate > employee.leavingDate) {
      throw new BadRequestException(
        `${fullName(employee)} left on ${employee.leavingDate}; leave cannot end after that`,
      );
    }
    await this.assertSettled(manager, employee);

    const others = (
      await this.leave.records(manager, employee.tenantId, employee.id)
    ).filter((r) => r.id !== current?.id);
    const clash = others.find(
      (r) => r.startDate <= next.endDate && r.endDate >= next.startDate,
    );
    if (clash) {
      throw new ConflictException(
        `${fullName(employee)} already has ${typeLabel(clash.type)} leave from ${clash.startDate} to ${clash.endDate}`,
      );
    }

    await this.assertNotPosted(manager, employee, periods);

    if (next.type === 'SICK') {
      const byYear = sickDaysByServiceYear({
        records: [...others, next].map((r) => ({
          type: r.type,
          startDate: r.startDate,
          endDate: r.endDate,
          days: r.days,
        })),
        joiningDate: employee.joiningDate,
        probationEndDate: employee.probationEndDate ?? null,
      });
      if ([...byYear.values()].some((d) => d > MAX_SICK_DAYS_PER_SERVICE_YEAR)) {
        throw new BadRequestException(
          'More than 90 sick days in one service year; record the employee as having left instead',
        );
      }
    }
  }

  /** A month whose posted run paid this employee is closed to leave changes. */
  private async assertNotPosted(
    manager: EntityManager,
    employee: Employee,
    periods: string[],
  ): Promise<void> {
    const wanted = new Set(periods);
    const hit = (await postedRunLines(manager, employee.tenantId, employee.id))
      .map(({ run }) => run)
      .filter((run) => wanted.has(run.period))
      .sort((a, b) => a.period.localeCompare(b.period))[0];
    if (hit) {
      throw new ConflictException(
        `Payroll ${hit.runNumber} for ${periodLabel(hit.period)} is already posted; void it to change leave in that month`,
      );
    }
  }

  private async assertSettled(manager: EntityManager, employee: Employee): Promise<void> {
    const settlements = await manager
      .getRepository(Settlement)
      .find({ where: { tenantId: employee.tenantId, employeeId: employee.id } });
    if (settlements.some((s) => s.status === 'APPROVED' || s.status === 'PAID')) {
      throw new ConflictException(`${fullName(employee)} is settled; leave can no longer change`);
    }
  }

  private union(a: string[], b: string[]): string[] {
    return [...new Set([...a, ...b])].sort();
  }

  private async loadEmployee(
    manager: EntityManager,
    tenantId: string,
    id: string,
  ): Promise<Employee> {
    const row = await manager.getRepository(Employee).findOne({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Employee not found');
    return row;
  }

  private async loadRecord(
    manager: EntityManager,
    tenantId: string,
    employeeId: string,
    id: string,
  ): Promise<LeaveRecord> {
    const row = await manager
      .getRepository(LeaveRecord)
      .findOne({ where: { id, tenantId, employeeId } });
    if (!row) throw new NotFoundException('Leave record not found');
    return row;
  }
}
