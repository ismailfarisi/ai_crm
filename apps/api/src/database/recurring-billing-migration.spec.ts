import type { QueryRunner } from 'typeorm';
import { RecurringBillingAndPrepaid1789900000001 } from './migrations/1789900000001-RecurringBillingAndPrepaid';

/**
 * The migration's backfill, run against a recording query runner (CI's schema
 * job runs it against Postgres). Legacy rows must not be back-billed: each
 * moves to its first occurrence on or after the migration date.
 * (Kept outside migrations/: TypeORM loads every file there as a migration.)
 */
describe('RecurringBillingAndPrepaid1789900000001 backfill', () => {
  function runner(today: string, legacy: Array<Record<string, string>>) {
    const updates: Array<[string, string]> = [];
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('AS "today"')) return [{ today }];
      if (sql.includes('FROM "recurring_expenses" WHERE "startDate" <')) {
        expect(params).toEqual([today]);
        return legacy;
      }
      if (sql.includes('SET "nextBillingDate"')) {
        updates.push(params as [string, string]);
      }
      return [];
    });
    return { qr: { query } as unknown as QueryRunner, updates };
  }

  it('moves each legacy row to its first occurrence on or after today, clamping month ends', async () => {
    const { qr, updates } = runner('2026-10-16', [
      { id: 'monthly', startDate: '2025-01-31', billingInterval: 'MONTHLY' },
      { id: 'monthly-today', startDate: '2026-03-16', billingInterval: 'MONTHLY' },
      { id: 'annual', startDate: '2024-02-29', billingInterval: 'ANNUAL' },
      { id: 'annual-past', startDate: '2023-11-30', billingInterval: 'ANNUAL' },
      { id: 'quarterly', startDate: '2026-05-31', billingInterval: 'QUARTERLY' },
    ]);
    await new RecurringBillingAndPrepaid1789900000001().up(qr);
    expect(updates).toEqual([
      ['monthly', '2026-10-31T00:00:00Z'],
      ['monthly-today', '2026-10-16T00:00:00Z'],
      ['annual', '2027-02-28T00:00:00Z'],
      ['annual-past', '2026-11-30T00:00:00Z'],
      ['quarterly', '2026-11-30T00:00:00Z'],
    ]);
  });

  it('leaves startDate alone and runs the backfill after startDate is set', async () => {
    const { qr } = runner('2026-10-16', []);
    await new RecurringBillingAndPrepaid1789900000001().up(qr);
    const sqls = (qr.query as jest.Mock).mock.calls.map((c) => c[0] as string);
    const setStart = sqls.findIndex((s) => s.includes('SET "startDate"'));
    const select = sqls.findIndex((s) => s.includes('AS "today"'));
    expect(setStart).toBeGreaterThanOrEqual(0);
    expect(select).toBeGreaterThan(setStart);
    expect(sqls.filter((s) => s.includes('SET "startDate"'))).toHaveLength(1);
  });
});
