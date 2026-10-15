import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  addMonthsToFirst, firstOfMonth, LEDGER_ROLES, prepaidSplit, utcToday,
  type LedgerRole, type PrepaidScheduleDto,
} from '@saas/shared';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { LedgerService } from '../finance/ledger.service';
import { PrepaidAmortization, PrepaidSchedule } from '../payables/entities/prepaid-schedule.entity';
import { TenantContextService } from '@/common/context/tenant-context.service';
import { AmortizationStore } from './amortization.store';

/** Thrown inside the transaction to roll back an entry whose month someone else posted. */
class MonthAlreadyPosted extends Error {}

/**
 * Releases prepaid expenses to their expense account, one month at a time.
 * The (schedule, month) unique row is the claim, so a month posts once.
 */
@Injectable()
export class PrepaidService {
  private readonly logger = new Logger(PrepaidService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly tenantContext: TenantContextService,
    private readonly amortizations: AmortizationStore,
  ) {}

  async releaseDue(today: string = utcToday()): Promise<void> {
    const active = await this.tenantContext.runAsSystem(() =>
      this.dataSource.manager.getRepository(PrepaidSchedule).find({ where: { status: 'ACTIVE' } }),
    );
    for (const schedule of active) {
      try {
        await this.tenantContext.runWithTenant(schedule.tenantId, () => this.releaseSchedule(schedule, today));
      } catch (err) {
        this.logger.warn(`Prepaid schedule ${schedule.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async releaseSchedule(schedule: PrepaidSchedule, today: string): Promise<void> {
    const split = prepaidSplit(schedule.totalBase, schedule.months);
    const currentMonth = firstOfMonth(today);
    const done = new Set(
      (await this.dataSource.manager
        .getRepository(PrepaidAmortization)
        .find({ where: { tenantId: schedule.tenantId, scheduleId: schedule.id } })
      ).map((a) => a.month),
    );
    for (let k = 0; k < schedule.months; k++) {
      const month = addMonthsToFirst(schedule.firstMonth, k);
      if (month > currentMonth) break;
      if (done.has(month)) continue;
      try {
        await this.dataSource.transaction((manager) =>
          this.postMonth(manager, schedule, month, split[k], `Release ${k + 1} of ${schedule.months}`),
        );
      } catch (e) {
        if (!(e instanceof MonthAlreadyPosted)) throw e;
      }
    }
    if (addMonthsToFirst(schedule.firstMonth, schedule.months - 1) <= currentMonth) {
      schedule.status = 'COMPLETED';
      await this.dataSource.manager.getRepository(PrepaidSchedule).save(schedule);
    }
  }

  /** Writes the journal entry, then claims the month; losing the claim throws to roll the entry back. */
  private async postMonth(manager: EntityManager, schedule: PrepaidSchedule, month: string, amount: number, label: string): Promise<void> {
    const journal = manager.getRepository(JournalEntry);
    const lines = await this.ledger.resolveLines(schedule.tenantId, [
      { role: schedule.expenseRole as LedgerRole, accountName: 'Released from prepaid', debit: amount, credit: 0, description: `${label} - bill line ${schedule.billLineId}` },
      { role: LEDGER_ROLES.PREPAID_EXPENSES, accountName: 'Prepaid expenses', debit: 0, credit: amount, description: `${label} - bill line ${schedule.billLineId}` },
    ], manager);
    const entry = await journal.save(journal.create({
      tenantId: schedule.tenantId,
      entryNumber: `JE-PRE-${schedule.id.slice(0, 8)}-${month}`,
      referenceType: 'PREPAID',
      referenceId: schedule.id,
      entryDate: new Date(`${month}T00:00:00Z`),
      totalAmount: amount,
      lines,
    }));
    const claimed = await this.amortizations.claim(manager, {
      tenantId: schedule.tenantId, scheduleId: schedule.id, month, amount, journalEntryId: entry.id,
    });
    if (!claimed) throw new MonthAlreadyPosted();
  }

  async endEarly(tenantId: string, id: string, actorId: string, today: string = utcToday()): Promise<PrepaidScheduleDto> {
    return this.dataSource.transaction(async (manager) => {
      const schedule = await manager.getRepository(PrepaidSchedule).findOne({ where: { id, tenantId } });
      if (!schedule) throw new NotFoundException('Prepaid schedule not found');
      if (schedule.status !== 'ACTIVE') throw new BadRequestException('This schedule is already closed');
      const released = await manager.getRepository(PrepaidAmortization).find({ where: { tenantId, scheduleId: id } });
      const releasedAmount = Math.round(released.reduce((s, a) => s + Number(a.amount), 0) * 100) / 100;
      const remainder = Math.round((schedule.totalBase - releasedAmount) * 100) / 100;
      const rows: Pick<PrepaidAmortization, 'amount'>[] = [...released];
      if (remainder > 0) {
        try {
          // month = today (a full date) so it cannot collide with a first-of-month release row.
          await this.postMonth(manager, schedule, today, remainder, `Ended early by ${actorId}`);
        } catch (e) {
          if (e instanceof MonthAlreadyPosted) throw new BadRequestException('This schedule was already ended today');
          throw e;
        }
        rows.push({ amount: remainder });
      }
      schedule.status = 'ENDED_EARLY';
      await manager.getRepository(PrepaidSchedule).save(schedule);
      return this.toDto(schedule, rows);
    });
  }

  async list(tenantId: string, billId?: string): Promise<PrepaidScheduleDto[]> {
    const repo = this.dataSource.manager.getRepository(PrepaidSchedule);
    const schedules = await repo.find({ where: billId ? { tenantId, billId } : { tenantId }, order: { createdAt: 'DESC' } });
    const amortizations = schedules.length
      ? await this.dataSource.manager.getRepository(PrepaidAmortization).find({ where: { tenantId } })
      : [];
    return schedules.map((s) => this.toDto(s, amortizations.filter((a) => a.scheduleId === s.id)));
  }

  private toDto(s: PrepaidSchedule, released: Pick<PrepaidAmortization, 'amount'>[]): PrepaidScheduleDto {
    const releasedAmount = Math.round(released.reduce((sum, a) => sum + Number(a.amount), 0) * 100) / 100;
    return {
      id: s.id, billId: s.billId, billLineId: s.billLineId, expenseRole: s.expenseRole,
      totalBase: s.totalBase, firstMonth: s.firstMonth, months: s.months,
      releasedMonths: released.length, releasedAmount,
      remainingAmount: Math.round((s.totalBase - releasedAmount) * 100) / 100,
      status: s.status,
    };
  }
}
