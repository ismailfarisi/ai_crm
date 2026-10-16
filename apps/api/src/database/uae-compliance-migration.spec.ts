import type { QueryRunner } from 'typeorm';
import { UaeCompliance1790100000000 } from './migrations/1790100000000-UaeCompliance';

/**
 * The UAE compliance migration, run against a recording query runner (CI's
 * schema job runs it against Postgres and checks for drift).
 * (Kept outside migrations/: TypeORM loads every file there as a migration.)
 */
describe('UaeCompliance1790100000000', () => {
  const TABLES = [
    'payroll_settings',
    'pension_schemes',
    'leave_records',
    'settlements',
    'settlement_lines',
    'leave_ledger_entries',
    'pension_remittances',
  ];

  async function record(direction: 'up' | 'down') {
    const query = jest.fn(async () => []);
    await new UaeCompliance1790100000000()[direction]({
      query,
    } as unknown as QueryRunner);
    return query.mock.calls.map((c) => ({
      sql: (c as unknown[])[0] as string,
      params: (c as unknown[])[1] as unknown[] | undefined,
    }));
  }

  it('adds the SETTLEMENT and PENSION_REMITTANCE reference types first', async () => {
    const calls = await record('up');
    expect(calls[0].sql).toBe(
      `ALTER TYPE "journal_entries_reference_type_enum" ADD VALUE IF NOT EXISTS 'SETTLEMENT'`,
    );
    expect(calls[1].sql).toBe(
      `ALTER TYPE "journal_entries_reference_type_enum" ADD VALUE IF NOT EXISTS 'PENSION_REMITTANCE'`,
    );
  });

  it('creates exactly the seven new tables, parents before children', async () => {
    const calls = await record('up');
    const created = calls
      .map((c) => /CREATE TABLE "([a-z_]+)"/.exec(c.sql)?.[1])
      .filter(Boolean);
    expect(created).toEqual(TABLES);
  });

  it('forces row level security on each of the seven tables', async () => {
    const calls = await record('up');
    for (const table of TABLES) {
      expect(calls.map((c) => c.sql)).toContain(
        `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`,
      );
    }
  });

  it('backfills 2410, 2420, 6320 and 6330, with only the expenses under 6000', async () => {
    const calls = await record('up');
    const inserts = calls.filter((c) =>
      c.sql.includes('INSERT INTO "ledger_accounts"'),
    );
    expect(inserts.map((c) => c.params?.[0])).toEqual([
      '2410',
      '2420',
      '6320',
      '6330',
    ]);
    expect(inserts.map((c) => c.params?.[5])).toEqual([
      null,
      null,
      '6000',
      '6000',
    ]);
  });

  it('bypasses RLS before the first insert', async () => {
    const calls = await record('up');
    const bypass = calls.findIndex((c) =>
      c.sql.includes(`set_config('app.bypass_rls','on',true)`),
    );
    const firstInsert = calls.findIndex((c) => c.sql.includes('INSERT INTO'));
    expect(bypass).toBeGreaterThanOrEqual(0);
    expect(firstInsert).toBeGreaterThan(bypass);
  });

  it('adds the pension scheme column to employees', async () => {
    const calls = await record('up');
    const alter = calls.find(
      (c) =>
        c.sql.includes('ALTER TABLE "employees"') &&
        c.sql.includes('"pension_scheme_id"'),
    );
    expect(alter?.sql).toContain('ADD COLUMN "pension_scheme_id" uuid');
  });

  it('drops settlement_lines before settlements on the way down', async () => {
    const calls = await record('down');
    const sqls = calls.map((c) => c.sql);
    const lines = sqls.indexOf(`DROP TABLE IF EXISTS "settlement_lines"`);
    const settlements = sqls.indexOf(`DROP TABLE IF EXISTS "settlements"`);
    expect(lines).toBeGreaterThanOrEqual(0);
    expect(settlements).toBeGreaterThan(lines);
  });
});
