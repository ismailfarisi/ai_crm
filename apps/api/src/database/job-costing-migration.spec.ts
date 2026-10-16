import type { QueryRunner } from 'typeorm';
import { getMetadataArgsStorage } from 'typeorm';
import { JobCosting1790200000000 } from './migrations/1790200000000-JobCosting';
import { TimesheetEntry } from '../modules/job-costing/entities/timesheet-entry.entity';
import { WorkOrderLabour } from '../modules/job-costing/entities/work-order-labour.entity';

/**
 * The job costing migration, run against a recording query runner (CI's
 * schema job runs it against Postgres and checks for drift).
 * (Kept outside migrations/: TypeORM loads every file there as a migration.)
 */
describe('JobCosting1790200000000', () => {
  const TABLES = ['timesheet_entries', 'work_order_labour'];

  async function record(direction: 'up' | 'down') {
    const query = jest.fn(async () => []);
    await new JobCosting1790200000000()[direction]({
      query,
    } as unknown as QueryRunner);
    return query.mock.calls.map((c) => ({
      sql: (c as unknown[])[0] as string,
      params: (c as unknown[])[1] as unknown[] | undefined,
    }));
  }

  it('creates the two new tables, timesheets first', async () => {
    const calls = await record('up');
    const created = calls
      .map((c) => /CREATE TABLE "([a-z_]+)"/.exec(c.sql)?.[1])
      .filter(Boolean);
    expect(created).toEqual(TABLES);
  });

  it('creates every index the two entities declare, by name', async () => {
    const calls = await record('up');
    const sql = calls.map((c) => c.sql).join('\n');
    const names = getMetadataArgsStorage()
      .indices.filter(
        (i) => i.target === TimesheetEntry || i.target === WorkOrderLabour,
      )
      .map((i) => i.name);
    expect(names.sort()).toEqual([
      'idx_timesheet_entries_employee_date',
      'idx_timesheet_entries_operation',
      'idx_timesheet_entries_work_order',
      'idx_work_order_labour_run',
      'idx_work_order_labour_work_order',
    ]);
    for (const name of names) expect(sql).toContain(`CREATE INDEX "${name}"`);
  });

  it('backfills 6390 under the SALARIES account, skipping a tenant that has the code or the role', async () => {
    const calls = await record('up');
    const inserts = calls.filter((c) =>
      c.sql.includes('INSERT INTO "ledger_accounts"'),
    );
    expect(inserts).toHaveLength(1);
    const sql = inserts[0].sql;
    expect(sql).toContain(`'6390'`);
    expect(sql).toContain(`'LABOUR_ABSORBED'`);
    expect(sql).toContain(`p."role" = 'SALARIES'`);
    expect(sql).toContain(
      `(x."role" = 'LABOUR_ABSORBED' OR x."code" = '6390')`,
    );
  });

  it('bypasses RLS before the backfill', async () => {
    const calls = await record('up');
    const bypass = calls.findIndex((c) =>
      c.sql.includes(`set_config('app.bypass_rls', 'on', true)`),
    );
    const insert = calls.findIndex((c) => c.sql.includes('INSERT INTO'));
    expect(bypass).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(bypass);
  });

  it('forces row level security on both tables', async () => {
    const calls = await record('up');
    for (const table of TABLES) {
      expect(calls.map((c) => c.sql)).toContain(
        `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`,
      );
    }
  });

  it('adds monthly standard hours with its 100..320 check', async () => {
    const calls = await record('up');
    const alter = calls.find((c) =>
      c.sql.includes('ALTER TABLE "payroll_settings"'),
    );
    expect(alter?.sql).toContain(
      `ADD COLUMN "monthly_standard_hours" numeric(6,2) NOT NULL DEFAULT 208`,
    );
    expect(alter?.sql).toContain(
      `CHECK ("monthly_standard_hours" BETWEEN 100 AND 320)`,
    );
  });

  it('drops both tables on the way down, and soft-deletes 6390', async () => {
    const calls = await record('down');
    const sqls = calls.map((c) => c.sql);
    for (const table of TABLES) {
      expect(sqls).toContain(`DROP TABLE IF EXISTS "${table}"`);
    }
    expect(
      sqls.some(
        (s) =>
          s.includes('SET "deletedAt" = now()') &&
          s.includes(`"role" = 'LABOUR_ABSORBED'`),
      ),
    ).toBe(true);
  });
});
