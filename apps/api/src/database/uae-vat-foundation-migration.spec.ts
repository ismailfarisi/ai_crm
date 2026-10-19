import type { QueryRunner } from 'typeorm';
import { UaeVatFoundation1790400000000 } from './migrations/1790400000000-UaeVatFoundation';

/**
 * The UAE VAT foundation migration, run against a recording query runner
 * (CI's schema job runs it against Postgres and checks for drift).
 * (Kept outside migrations/: TypeORM loads every file there as a migration.)
 */
describe('UaeVatFoundation1790400000000', () => {
  const TABLES = ['branches', 'vat_settings'];

  async function record(direction: 'up' | 'down') {
    const query = jest.fn(async () => []);
    await new UaeVatFoundation1790400000000()[direction]({
      query,
    } as unknown as QueryRunner);
    return query.mock.calls.map((c) => (c as unknown[])[0] as string);
  }

  it('creates exactly the two new tables', async () => {
    const sqls = await record('up');
    const created = sqls
      .map((sql) => /CREATE TABLE "([a-z_]+)"/.exec(sql)?.[1])
      .filter(Boolean);
    expect(created).toEqual(TABLES);
  });

  it('enables, forces and adds the tenant isolation policy on both tables', async () => {
    const sqls = await record('up');
    for (const table of TABLES) {
      expect(sqls).toContain(
        `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`,
      );
      expect(sqls).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      expect(
        sqls.some((sql) =>
          sql.startsWith(
            `CREATE POLICY tenant_isolation_policy ON "${table}" FOR ALL`,
          ),
        ),
      ).toBe(true);
    }
  });

  it('allows one head office per tenant', async () => {
    const sqls = await record('up');
    expect(sqls).toContain(
      `CREATE UNIQUE INDEX "uq_branches_tenant_head_office" ON "branches" ("tenant_id") WHERE "is_head_office"`,
    );
  });

  it('backfills a head-office branch per organization, after bypassing RLS', async () => {
    const sqls = await record('up');
    const bypass = sqls.findIndex((sql) =>
      sql.includes(`set_config('app.bypass_rls', 'on', true)`),
    );
    const insert = sqls.findIndex(
      (sql) =>
        sql.includes('INSERT INTO "branches"') &&
        /SELECT[\s\S]*FROM "organizations"/.test(sql),
    );
    expect(bypass).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(bypass);
    expect(sqls[insert]).toContain(`'Head office'`);
  });

  it('backfills VAT status on customers and suppliers, and the zero-rated treatment', async () => {
    const sqls = await record('up');
    expect(
      sqls.some(
        (sql) =>
          sql.includes('UPDATE "customers"') && sql.includes('"vatStatus"'),
      ),
    ).toBe(true);
    expect(
      sqls.some(
        (sql) =>
          sql.includes('UPDATE "suppliers"') && sql.includes('"vat_status"'),
      ),
    ).toBe(true);
    expect(
      sqls.some(
        (sql) =>
          sql.includes('UPDATE "tax_codes"') &&
          sql.includes(`"treatment" = 'ZERO_RATED'`),
      ),
    ).toBe(true);
  });

  // A UAE purchase reverse charge (or import) is self-assessed at 5%.
  it('lets only a UAE purchase reverse charge or import carry a rate', async () => {
    const up = (await record('up')).join('\n');
    expect(up).toMatch(
      /DROP CONSTRAINT "CHK_tax_codes_reverse_charge_zero",\s*ADD CONSTRAINT "CHK_tax_codes_reverse_charge_zero" CHECK \(\s*NOT "is_reverse_charge" OR "rate" = 0\s*OR \("kind" = 'PURCHASE' AND "treatment" IN \('REVERSE_CHARGE', 'IMPORT_GOODS'\)\)/,
    );
    const down = (await record('down')).join('\n');
    expect(down).toContain(
      `CHECK (NOT "is_reverse_charge" OR "rate" = 0) NOT VALID`,
    );
  });

  it('drops both tables and every added column on the way down', async () => {
    const sqls = (await record('down')).join('\n');
    expect(sqls).toContain(`DROP TABLE IF EXISTS "branches"`);
    expect(sqls).toContain(`DROP TABLE IF EXISTS "vat_settings"`);
    expect(sqls).toMatch(
      /ALTER TABLE "customers"[\s\S]*DROP COLUMN IF EXISTS "emirate"[\s\S]*DROP COLUMN IF EXISTS "vatStatus"/,
    );
    expect(sqls).toMatch(
      /ALTER TABLE "suppliers"[\s\S]*DROP COLUMN IF EXISTS "emirate"[\s\S]*DROP COLUMN IF EXISTS "vat_status"/,
    );
    expect(sqls).toMatch(
      /ALTER TABLE "tax_codes"[\s\S]*DROP COLUMN IF EXISTS "treatment"/,
    );
  });
});
