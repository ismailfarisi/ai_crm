import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Recurring expenses become bill generators, and bill lines can be spread
 * through 1400 Prepaid expenses.
 *
 * - `recurring_expenses` gains a supplier, a start/end date, tax code,
 *   auto-approve (and who switched it on), spread-over-period and creator;
 *   the interval enum gains QUARTERLY and SEMI_ANNUAL.
 * - `recurring_expense_occurrences`: one row per generated period. The unique
 *   (recurringExpenseId, periodStart) index is the claim that stops a period
 *   being billed twice.
 * - `supplier_bill_lines` gains a category and a service period.
 * - `prepaid_schedules` / `prepaid_amortizations`: a line booked to prepaid
 *   and the monthly releases out of it (journal reference type PREPAID).
 *
 * Existing rows are backfilled: startDate from nextBillingDate, spread on for
 * anything not monthly, a supplier where exactly one name matches, and the
 * subscription modal's old categories mapped onto the shared list.
 *
 * Foreign keys live here rather than on the entities (the drift check ignores
 * them). The new tables are tenant-isolated by RLS like every other tenant
 * table.
 */

/** Mirrors LEGACY_SUBSCRIPTION_CATEGORIES in @saas/shared, frozen as of this migration. */
const LEGACY_SUBSCRIPTION_CATEGORIES: Array<[from: string, to: string]> = [
  ['Cloud Infrastructure', 'Software & SaaS'],
  ['Marketing Tools', 'Marketing & Advertising'],
  ['Security & Compliance', 'Software & SaaS'],
  ['Communication & Collaboration', 'Software & SaaS'],
  ['Customer Support', 'Software & SaaS'],
  ['Design & Creative', 'Software & SaaS'],
  ['Office Utilities', 'Utilities & Telecom'],
];

const NEW_TENANT_TABLES: Array<[table: string, tenantColumn: string]> = [
  ['recurring_expense_occurrences', 'tenantId'],
  ['prepaid_schedules', 'tenant_id'],
  ['prepaid_amortizations', 'tenant_id'],
];

export class RecurringBillingAndPrepaid1789900000001 implements MigrationInterface {
  name = 'RecurringBillingAndPrepaid1789900000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Postgres 12+ allows ADD VALUE inside a transaction; the new values are
    // not used by anything later in this migration.
    await queryRunner.query(
      `ALTER TYPE "recurring_expenses_billing_interval_enum" ADD VALUE IF NOT EXISTS 'QUARTERLY'`,
    );
    await queryRunner.query(
      `ALTER TYPE "recurring_expenses_billing_interval_enum" ADD VALUE IF NOT EXISTS 'SEMI_ANNUAL'`,
    );
    await queryRunner.query(
      `ALTER TYPE "journal_entries_reference_type_enum" ADD VALUE IF NOT EXISTS 'PREPAID'`,
    );

    // ─── recurring_expenses ────────────────────────────────────────────────
    await queryRunner.query(`ALTER TABLE "recurring_expenses" ADD "supplierId" uuid`);
    await queryRunner.query(`ALTER TABLE "recurring_expenses" ADD "startDate" date`);
    await queryRunner.query(`ALTER TABLE "recurring_expenses" ADD "endDate" date`);
    await queryRunner.query(`ALTER TABLE "recurring_expenses" ADD "taxCodeId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "recurring_expenses" ADD "autoApprove" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "recurring_expenses" ADD "autoApproveById" uuid`);
    await queryRunner.query(
      `ALTER TABLE "recurring_expenses" ADD "spreadOverPeriod" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "recurring_expenses" ADD "createdById" uuid`);
    await queryRunner.query(
      `ALTER TABLE "recurring_expenses" ADD CONSTRAINT "FK_recurring_expenses_supplier_id" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Backfill across every tenant.
    await queryRunner.query(`SELECT set_config('app.bypass_rls','on',true)`);
    await queryRunner.query(
      `UPDATE "recurring_expenses" SET "startDate" = ("nextBillingDate" AT TIME ZONE 'UTC')::date`,
    );
    await queryRunner.query(
      `ALTER TABLE "recurring_expenses" ALTER COLUMN "startDate" SET NOT NULL`,
    );
    await queryRunner.query(
      `UPDATE "recurring_expenses" SET "spreadOverPeriod" = ("billingInterval" <> 'MONTHLY')`,
    );
    // A supplier only where exactly one live supplier carries the vendor name.
    await queryRunner.query(`
      UPDATE "recurring_expenses" r SET "supplierId" = s."id"
        FROM "suppliers" s
       WHERE s."tenant_id" = r."tenantId" AND s."deletedAt" IS NULL
         AND lower(trim(s."company_name")) = lower(trim(r."vendorName"))
         AND (SELECT count(*) FROM "suppliers" s2
               WHERE s2."tenant_id" = r."tenantId" AND s2."deletedAt" IS NULL
                 AND lower(trim(s2."company_name")) = lower(trim(r."vendorName"))) = 1`);
    for (const [from, to] of LEGACY_SUBSCRIPTION_CATEGORIES) {
      await queryRunner.query(
        `UPDATE "recurring_expenses" SET "category" = $2 WHERE "category" = $1`,
        [from, to],
      );
    }

    // ─── recurring_expense_occurrences ─────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "recurring_expense_occurrences" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenantId" uuid NOT NULL,
        "recurringExpenseId" uuid NOT NULL,
        "occurrenceIndex" integer NOT NULL,
        "periodStart" date NOT NULL,
        "periodEnd" date NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "billId" uuid,
        "status" character varying(20) NOT NULL,
        "error" text,
        "attempts" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_recurring_expense_occurrences_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_recurring_expense_occurrences_tenant" FOREIGN KEY ("tenantId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_recurring_expense_occurrences_recurring_expense" FOREIGN KEY ("recurringExpenseId") REFERENCES "recurring_expenses"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_recurring_expense_occurrences_bill" FOREIGN KEY ("billId") REFERENCES "supplier_bills"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_recurring_occurrence_period" ON "recurring_expense_occurrences" ("recurringExpenseId", "periodStart")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_recurring_occurrences_tenant" ON "recurring_expense_occurrences" ("tenantId")`,
    );

    // ─── supplier_bill_lines ───────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "supplier_bill_lines" ADD "category" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "supplier_bill_lines" ADD "service_period_start" date`,
    );
    await queryRunner.query(
      `ALTER TABLE "supplier_bill_lines" ADD "service_period_end" date`,
    );

    // ─── prepaid_schedules ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "prepaid_schedules" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "bill_id" uuid NOT NULL,
        "bill_line_id" uuid NOT NULL,
        "expense_role" character varying(40) NOT NULL,
        "total_base" numeric(14,2) NOT NULL,
        "first_month" date NOT NULL,
        "months" integer NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'ACTIVE',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_prepaid_schedules_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_prepaid_schedules_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_prepaid_schedules_bill" FOREIGN KEY ("bill_id") REFERENCES "supplier_bills"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_prepaid_schedules_bill_line" FOREIGN KEY ("bill_line_id") REFERENCES "supplier_bill_lines"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_prepaid_schedules_tenant" ON "prepaid_schedules" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_prepaid_schedules_bill_line" ON "prepaid_schedules" ("bill_line_id")`,
    );

    // ─── prepaid_amortizations ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "prepaid_amortizations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "schedule_id" uuid NOT NULL,
        "month" date NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "journal_entry_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_prepaid_amortizations_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_prepaid_amortizations_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_prepaid_amortizations_schedule" FOREIGN KEY ("schedule_id") REFERENCES "prepaid_schedules"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_prepaid_amortizations_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_prepaid_amortization_month" ON "prepaid_amortizations" ("schedule_id", "month")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_prepaid_amortizations_tenant" ON "prepaid_amortizations" ("tenant_id")`,
    );

    // ─── RLS (same policy as 1787600000000-EnablePostgresRowLevelSecurity) ─
    for (const [table, tenantColumn] of NEW_TENANT_TABLES) {
      const column = `"${tenantColumn}"`;
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation_policy ON "${table}"`);
      await queryRunner.query(
        `CREATE POLICY tenant_isolation_policy ON "${table}" FOR ALL ` +
          `USING (current_setting('app.bypass_rls', true) = 'on' OR ${column} = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
          `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR ${column} = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Policies go with their tables.
    await queryRunner.query(`DROP TABLE IF EXISTS "prepaid_amortizations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "prepaid_schedules"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "recurring_expense_occurrences"`);

    await queryRunner.query(`ALTER TABLE "supplier_bill_lines" DROP COLUMN IF EXISTS "service_period_end"`);
    await queryRunner.query(`ALTER TABLE "supplier_bill_lines" DROP COLUMN IF EXISTS "service_period_start"`);
    await queryRunner.query(`ALTER TABLE "supplier_bill_lines" DROP COLUMN IF EXISTS "category"`);

    await queryRunner.query(
      `ALTER TABLE "recurring_expenses" DROP CONSTRAINT IF EXISTS "FK_recurring_expenses_supplier_id"`,
    );
    for (const column of [
      'createdById',
      'spreadOverPeriod',
      'autoApproveById',
      'autoApprove',
      'taxCodeId',
      'endDate',
      'startDate',
      'supplierId',
    ]) {
      await queryRunner.query(`ALTER TABLE "recurring_expenses" DROP COLUMN IF EXISTS "${column}"`);
    }

    // Enum values cannot be dropped in Postgres: QUARTERLY / SEMI_ANNUAL on
    // recurring_expenses_billing_interval_enum and PREPAID on
    // journal_entries_reference_type_enum stay. Category renames are not
    // reversed (the old names were a private list of the subscription modal).
  }
}
