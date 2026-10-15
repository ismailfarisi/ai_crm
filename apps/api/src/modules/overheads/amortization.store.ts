import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { PrepaidAmortization } from '../payables/entities/prepaid-schedule.entity';

/**
 * The claim for a prepaid month: whoever inserts the (schedule, month) row
 * posts it. Runs on the caller's transaction so a lost race rolls back the
 * journal entry written just before it.
 */
@Injectable()
export class AmortizationStore {
  async claim(
    manager: EntityManager,
    values: Pick<
      PrepaidAmortization,
      'tenantId' | 'scheduleId' | 'month' | 'amount' | 'journalEntryId'
    >,
  ): Promise<PrepaidAmortization | null> {
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(PrepaidAmortization)
      .values(values)
      .orIgnore() // ON CONFLICT DO NOTHING
      .returning('*')
      .execute();
    const raw = (result.raw as PrepaidAmortization[])[0];
    return raw ? manager.getRepository(PrepaidAmortization).create(raw) : null;
  }
}
