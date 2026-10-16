import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RecurringExpenseOccurrence } from '../finance/entities/recurring-expense-occurrence.entity';

/** Marks a period someone is generating right now (or crashed while generating). */
export const IN_PROGRESS = 'in progress';

/**
 * The claim: whoever inserts the (recurring expense, period) row bills it.
 *
 * A claimed-but-crashed row stays `FAILED` with `error = 'in progress'` and is
 * never reclaimed automatically — recovering it is a manual
 * `UPDATE … SET error = 'stale'`. It can stall a schedule; it can never
 * double-bill.
 */
@Injectable()
export class OccurrenceStore {
  constructor(
    @InjectRepository(RecurringExpenseOccurrence)
    private readonly repo: Repository<RecurringExpenseOccurrence>,
  ) {}

  async claim(
    o: Pick<
      RecurringExpenseOccurrence,
      | 'tenantId'
      | 'recurringExpenseId'
      | 'occurrenceIndex'
      | 'periodStart'
      | 'periodEnd'
      | 'amount'
    >,
  ): Promise<RecurringExpenseOccurrence | null> {
    const result = await this.repo
      .createQueryBuilder()
      .insert()
      .into(RecurringExpenseOccurrence)
      .values({ ...o, status: 'FAILED', attempts: 0, error: IN_PROGRESS })
      .orIgnore() // ON CONFLICT DO NOTHING
      .returning('*')
      .execute();
    const raw = (result.raw as RecurringExpenseOccurrence[])[0];
    return raw ? this.repo.create(raw) : null;
  }

  /** A FAILED period is retried by whoever flips it back to in-progress first. */
  async reclaimFailed(
    recurringExpenseId: string,
    periodStart: string,
  ): Promise<RecurringExpenseOccurrence | null> {
    const result = await this.repo
      .createQueryBuilder()
      .update(RecurringExpenseOccurrence)
      .set({ error: IN_PROGRESS })
      .where(
        '"recurringExpenseId" = :recurringExpenseId AND "periodStart" = :periodStart',
        { recurringExpenseId, periodStart },
      )
      .andWhere(
        `"status" = 'FAILED' AND ("error" IS NULL OR "error" <> :inProgress)`,
        { inProgress: IN_PROGRESS },
      )
      .returning('*')
      .execute();
    const raw = (result.raw as RecurringExpenseOccurrence[])[0];
    return raw ? this.repo.create(raw) : null;
  }

  findByPeriod(
    recurringExpenseId: string,
    periodStart: string,
  ): Promise<RecurringExpenseOccurrence | null> {
    return this.repo.findOne({ where: { recurringExpenseId, periodStart } });
  }

  async update(
    id: string,
    patch: Partial<
      Pick<
        RecurringExpenseOccurrence,
        'status' | 'billId' | 'error' | 'attempts'
      >
    >,
  ): Promise<void> {
    await this.repo.update({ id }, patch);
  }
}
