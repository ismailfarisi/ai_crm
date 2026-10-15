import type { QueryRunner } from 'typeorm';
import { EmployeesAndPayroll1790000000000 } from './migrations/1790000000000-EmployeesAndPayroll';

/**
 * The payroll migration, run against a recording query runner (CI's schema
 * job runs it against Postgres and checks for drift).
 * (Kept outside migrations/: TypeORM loads every file there as a migration.)
 */
describe('EmployeesAndPayroll1790000000000', () => {
  const TABLES = [
    'employees',
    'salary_packages',
    'employee_advances',
    'payroll_runs',
    'payroll_run_lines',
    'gratuity_ledger_entries',
  ];

  async function runUp() {
    const query = jest.fn(async () => []);
    await new EmployeesAndPayroll1790000000000().up({
      query,
    } as unknown as QueryRunner);
    return query.mock.calls.map((c) => ({
      sql: (c as unknown[])[0] as string,
      params: (c as unknown[])[1] as unknown[] | undefined,
    }));
  }

  it('adds the PAYROLL reference type first', async () => {
    const calls = await runUp();
    expect(calls[0].sql).toBe(
      `ALTER TYPE "journal_entries_reference_type_enum" ADD VALUE IF NOT EXISTS 'PAYROLL'`,
    );
  });

  it('creates exactly the six payroll tables', async () => {
    const calls = await runUp();
    const created = calls
      .map((c) => /CREATE TABLE "([a-z_]+)"/.exec(c.sql)?.[1])
      .filter(Boolean);
    expect(created.sort()).toEqual([...TABLES].sort());
  });

  it('forces row level security on each of the six tables', async () => {
    const calls = await runUp();
    for (const table of TABLES) {
      expect(calls.map((c) => c.sql)).toContain(
        `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`,
      );
    }
  });

  it('backfills 1450, 2300, 2400 and 6310, with only 6310 under 6000', async () => {
    const calls = await runUp();
    const inserts = calls.filter((c) =>
      c.sql.includes('INSERT INTO "ledger_accounts"'),
    );
    expect(inserts.map((c) => c.params?.[0])).toEqual([
      '1450',
      '2300',
      '2400',
      '6310',
    ]);
    expect(inserts.map((c) => c.params?.[5])).toEqual([
      null,
      null,
      null,
      '6000',
    ]);
  });

  it('bypasses RLS before the first insert', async () => {
    const calls = await runUp();
    const bypass = calls.findIndex((c) =>
      c.sql.includes(`set_config('app.bypass_rls','on',true)`),
    );
    const firstInsert = calls.findIndex((c) => c.sql.includes('INSERT INTO'));
    expect(bypass).toBeGreaterThanOrEqual(0);
    expect(firstInsert).toBeGreaterThan(bypass);
  });
});
