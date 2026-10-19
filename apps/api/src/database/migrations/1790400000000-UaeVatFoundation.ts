import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * UAE VAT foundation.
 *
 * - `branches`: a tenant's places of business, each in an emirate (the VAT201
 *   splits sales by emirate). One head office per tenant, backfilled for
 *   every existing organization from its address.
 * - `vat_settings`: one row per tenant — period frequency and anchor, the
 *   registration and VAT start dates, and the tax agent / agency.
 * - `emirate` and VAT status on customers (quoted camelCase, like the rest of
 *   that table) and suppliers (snake_case), with the status backfilled from
 *   country and tax ID the way `defaultVatStatus` in @saas/shared decides it.
 * - `tax_codes.treatment`, backfilled to ZERO_RATED for the starter ZERO code.
 *
 * Foreign keys and CHECK constraints live here rather than on the entities
 * (the drift check ignores FK_ / CHK_ constraints). Both new tables are
 * tenant-isolated by RLS like every other tenant table.
 */

/** Frozen as of this migration (mirrors EMIRATES in @saas/shared). */
const EMIRATES = `('AUH', 'DXB', 'SHJ', 'AJM', 'UAQ', 'RAK', 'FUJ')`;
const VAT_STATUSES = `('REGISTERED', 'NOT_REGISTERED', 'OUTSIDE_UAE')`;
const TREATMENTS = `('STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE', 'REVERSE_CHARGE', 'BLOCKED', 'IMPORT_GOODS')`;

/**
 * Emirate name or code → code, matched on the whole string with everything
 * but letters and digits removed, as `emirateFromText` does.
 */
const EMIRATE_KEYS: Array<[code: string, name: string]> = [
  ['AUH', 'abudhabi'],
  ['DXB', 'dubai'],
  ['SHJ', 'sharjah'],
  ['AJM', 'ajman'],
  ['UAQ', 'ummalquwain'],
  ['RAK', 'rasalkhaimah'],
  ['FUJ', 'fujairah'],
];

const NEW_TENANT_TABLES: Array<[table: string, tenantColumn: string]> = [
  ['branches', 'tenant_id'],
  ['vat_settings', 'tenant_id'],
];

export class UaeVatFoundation1790400000000 implements MigrationInterface {
  name = 'UaeVatFoundation1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── branches ──────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "branches" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "address_line1" character varying(200),
        "address_line2" character varying(200),
        "city" character varying(120),
        "emirate" character varying(3),
        "is_head_office" boolean NOT NULL DEFAULT false,
        "invoice_prefix" character varying(6),
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_branches_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_branches_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "CHK_branches_emirate" CHECK ("emirate" IN ${EMIRATES})
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_branches_tenant_head_office" ON "branches" ("tenant_id") WHERE "is_head_office"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_branches_tenant_invoice_prefix" ON "branches" ("tenant_id", "invoice_prefix") WHERE "invoice_prefix" IS NOT NULL`,
    );

    // ─── vat_settings ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "vat_settings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "period_frequency" character varying(10) NOT NULL,
        "first_period_start" date NOT NULL,
        "registration_date" date NOT NULL,
        "vat_start_date" date NOT NULL,
        "tax_agent_name" character varying(200),
        "tax_agency_name" character varying(200),
        "tan" character varying(20),
        "taan" character varying(20),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vat_settings_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_vat_settings_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "CHK_vat_settings_period_frequency" CHECK ("period_frequency" IN ('MONTHLY', 'QUARTERLY'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_vat_settings_tenant" ON "vat_settings" ("tenant_id")`,
    );

    // ─── columns on existing tables ────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "customers"
        ADD COLUMN "emirate" character varying(3),
        ADD COLUMN "vatStatus" character varying(16) NOT NULL DEFAULT 'NOT_REGISTERED',
        ADD CONSTRAINT "CHK_customers_emirate" CHECK ("emirate" IN ${EMIRATES}),
        ADD CONSTRAINT "CHK_customers_vat_status" CHECK ("vatStatus" IN ${VAT_STATUSES})
    `);
    await queryRunner.query(`
      ALTER TABLE "suppliers"
        ADD COLUMN "emirate" character varying(3),
        ADD COLUMN "vat_status" character varying(16) NOT NULL DEFAULT 'NOT_REGISTERED',
        ADD CONSTRAINT "CHK_suppliers_emirate" CHECK ("emirate" IN ${EMIRATES}),
        ADD CONSTRAINT "CHK_suppliers_vat_status" CHECK ("vat_status" IN ${VAT_STATUSES})
    `);
    await queryRunner.query(`
      ALTER TABLE "tax_codes"
        ADD COLUMN "treatment" character varying(20),
        ADD CONSTRAINT "CHK_tax_codes_treatment" CHECK ("treatment" IN ${TREATMENTS})
    `);
    // A UAE purchase reverse charge or goods import is self-assessed at 5%, so
    // "reverse charge means 0%" now holds only for codes without one of those
    // treatments (every EU code, and a UAE sales reverse-charge notice).
    await queryRunner.query(`
      ALTER TABLE "tax_codes"
        DROP CONSTRAINT "CHK_tax_codes_reverse_charge_zero",
        ADD CONSTRAINT "CHK_tax_codes_reverse_charge_zero" CHECK (
          NOT "is_reverse_charge" OR "rate" = 0
          OR ("kind" = 'PURCHASE' AND "treatment" IN ('REVERSE_CHARGE', 'IMPORT_GOODS'))
        )
    `);

    // ─── backfills, across every tenant ────────────────────────────────────
    await queryRunner.query(`SELECT set_config('app.bypass_rls', 'on', true)`);

    // One head office per organization, at the organization's address.
    // The region wins; when it names a district rather than an emirate
    // ('Business Bay'), the city is tried next.
    const emirateCase = (column: string) =>
      `CASE regexp_replace(lower(${column}), '[^a-z0-9]', '', 'g') ` +
      EMIRATE_KEYS.map(
        ([code, name]) =>
          `WHEN '${name}' THEN '${code}' WHEN '${code.toLowerCase()}' THEN '${code}'`,
      ).join(' ') +
      ` ELSE NULL END`;
    const headOfficeEmirate = `COALESCE(${emirateCase('o."region"')}, ${emirateCase('o."city"')})`;
    await queryRunner.query(
      `INSERT INTO "branches" ("tenant_id", "name", "address_line1", "address_line2", "city", "emirate", "is_head_office")
       SELECT o."id", 'Head office', o."address_line1", o."address_line2", o."city", ${headOfficeEmirate}, true
       FROM "organizations" o`,
    );

    // VAT status, as defaultVatStatus decides it: a country other than the UAE
    // is outside it; the UAE with a 15-digit TRN is registered (and the TRN is
    // stored as digits); anything else keeps the NOT_REGISTERED default. The
    // UAE is 'AE' or, on records typed as free text, one of its legacy names;
    // the country text itself is left as it is.
    const uaeNames = `('ae', 'united arab emirates', 'uae', 'u.a.e.')`;
    for (const [table, status, country, taxId] of [
      ['customers', '"vatStatus"', '"country"', '"taxId"'],
      ['suppliers', '"vat_status"', '"country"', '"tax_id"'],
    ] as const) {
      const code = `lower(nullif(trim(${country}), ''))`;
      const trn = `regexp_replace(${taxId}, '[\\s-]', '', 'g')`;
      await queryRunner.query(
        `UPDATE "${table}" SET ${status} = 'OUTSIDE_UAE'
          WHERE ${code} IS NOT NULL AND ${code} NOT IN ${uaeNames}`,
      );
      await queryRunner.query(
        `UPDATE "${table}" SET ${status} = 'REGISTERED', ${taxId} = ${trn}
          WHERE ${code} IN ${uaeNames} AND ${trn} ~ '^[0-9]{15}$'`,
      );
    }

    await queryRunner.query(
      `UPDATE "tax_codes" SET "treatment" = 'ZERO_RATED' WHERE "code" = 'ZERO' AND "rate" = 0`,
    );

    // ─── RLS (same policy as 1787600000000-EnablePostgresRowLevelSecurity) ─
    for (const [table, tenantColumn] of NEW_TENANT_TABLES) {
      const column = `"${tenantColumn}"`;
      await queryRunner.query(
        `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(
        `DROP POLICY IF EXISTS tenant_isolation_policy ON "${table}"`,
      );
      await queryRunner.query(
        `CREATE POLICY tenant_isolation_policy ON "${table}" FOR ALL ` +
          `USING (current_setting('app.bypass_rls', true) = 'on' OR ${column} = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
          `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR ${column} = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Policies go with their tables. Normalised TRNs stay normalised.
    await queryRunner.query(`DROP TABLE IF EXISTS "vat_settings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "branches"`);

    // NOT VALID: 5% reverse-charge codes created since may still exist; the
    // rule binds new rows again without failing the rollback on old ones.
    await queryRunner.query(`
      ALTER TABLE "tax_codes"
        DROP CONSTRAINT IF EXISTS "CHK_tax_codes_reverse_charge_zero",
        ADD CONSTRAINT "CHK_tax_codes_reverse_charge_zero" CHECK (NOT "is_reverse_charge" OR "rate" = 0) NOT VALID
    `);
    await queryRunner.query(`
      ALTER TABLE "tax_codes"
        DROP CONSTRAINT IF EXISTS "CHK_tax_codes_treatment",
        DROP COLUMN IF EXISTS "treatment"
    `);
    await queryRunner.query(`
      ALTER TABLE "suppliers"
        DROP CONSTRAINT IF EXISTS "CHK_suppliers_emirate",
        DROP CONSTRAINT IF EXISTS "CHK_suppliers_vat_status",
        DROP COLUMN IF EXISTS "emirate",
        DROP COLUMN IF EXISTS "vat_status"
    `);
    await queryRunner.query(`
      ALTER TABLE "customers"
        DROP CONSTRAINT IF EXISTS "CHK_customers_emirate",
        DROP CONSTRAINT IF EXISTS "CHK_customers_vat_status",
        DROP COLUMN IF EXISTS "emirate",
        DROP COLUMN IF EXISTS "vatStatus"
    `);
  }
}
