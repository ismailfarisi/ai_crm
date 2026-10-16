import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Job costing: timesheets and actual labour on work orders.
 *
 * - Run-line labour columns (standard, logged and direct hours, rate,
 *   absorbed), the run's labour total and its two labour journal links.
 * - `payroll_settings.monthly_standard_hours` (default 208, 100..320).
 * - `work_orders.labour_status` and `labour_split`.
 * - `timesheet_entries` and `work_order_labour`.
 * - 6390 Labour absorbed (role LABOUR_ABSORBED) under 6300 Salaries & wages,
 *   backfilled to every existing tenant (new tenants get it from
 *   provisionChartOfAccounts). A tenant that already uses the code or the
 *   role is skipped, as in 1790000000000.
 *
 * Foreign keys and CHECK constraints live here rather than on the entities
 * (the drift check ignores FK_ / CHK_ constraints). Both new tables are
 * tenant-isolated by RLS like every other tenant table.
 */

const NEW_TENANT_TABLES: Array<[table: string, tenantColumn: string]> = [
  ['timesheet_entries', 'tenant_id'],
  ['work_order_labour', 'tenant_id'],
];

export class JobCosting1790200000000 implements MigrationInterface {
  name = 'JobCosting1790200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── columns on existing tables ────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "payroll_run_lines"
        ADD COLUMN "standard_hours" numeric(7,2) NOT NULL DEFAULT 0,
        ADD COLUMN "logged_hours" numeric(7,2) NOT NULL DEFAULT 0,
        ADD COLUMN "direct_hours" numeric(7,2) NOT NULL DEFAULT 0,
        ADD COLUMN "labour_rate" numeric(12,4) NOT NULL DEFAULT 0,
        ADD COLUMN "labour_absorbed" numeric(14,2) NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "payroll_runs"
        ADD COLUMN "total_labour_absorbed" numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN "labour_journal_entry_id" uuid,
        ADD COLUMN "labour_void_journal_entry_id" uuid,
        ADD CONSTRAINT "FK_payroll_runs_labour_journal_entry" FOREIGN KEY ("labour_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        ADD CONSTRAINT "FK_payroll_runs_labour_void_journal_entry" FOREIGN KEY ("labour_void_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "payroll_settings"
        ADD COLUMN "monthly_standard_hours" numeric(6,2) NOT NULL DEFAULT 208,
        ADD CONSTRAINT "CHK_payroll_settings_standard_hours" CHECK ("monthly_standard_hours" BETWEEN 100 AND 320)
    `);
    await queryRunner.query(`
      ALTER TABLE "work_orders"
        ADD COLUMN "labour_status" character varying(12),
        ADD COLUMN "labour_split" jsonb,
        ADD CONSTRAINT "CHK_work_orders_labour_status" CHECK ("labour_status" IN ('ACTUAL', 'PROVISIONAL', 'MIXED', 'STANDARD'))
    `);

    // ─── timesheet_entries ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "timesheet_entries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "employee_id" uuid NOT NULL,
        "work_date" date NOT NULL,
        "hours" numeric(5,2) NOT NULL,
        "work_order_id" uuid,
        "operation_id" uuid,
        "indirect_category" character varying(20),
        "source" character varying(10) NOT NULL DEFAULT 'MANUAL',
        "note" text,
        "run_line_id" uuid,
        "created_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_timesheet_entries_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_timesheet_entries_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_timesheet_entries_employee" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_timesheet_entries_work_order" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_timesheet_entries_operation" FOREIGN KEY ("operation_id") REFERENCES "work_order_operations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_timesheet_entries_run_line" FOREIGN KEY ("run_line_id") REFERENCES "payroll_run_lines"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "CHK_timesheet_entries_hours" CHECK ("hours" > 0 AND "hours" <= 24),
        CONSTRAINT "CHK_timesheet_entries_target" CHECK (("operation_id" IS NULL) <> ("indirect_category" IS NULL)),
        CONSTRAINT "CHK_timesheet_entries_work_order" CHECK (("work_order_id" IS NULL) = ("operation_id" IS NULL)),
        CONSTRAINT "CHK_timesheet_entries_indirect_category" CHECK ("indirect_category" IN ('CLEANING', 'MAINTENANCE', 'TRAINING', 'IDLE', 'OTHER')),
        CONSTRAINT "CHK_timesheet_entries_source" CHECK ("source" IN ('MANUAL', 'CLOCK'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_timesheet_entries_employee_date" ON "timesheet_entries" ("tenant_id", "employee_id", "work_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_timesheet_entries_operation" ON "timesheet_entries" ("operation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_timesheet_entries_work_order" ON "timesheet_entries" ("work_order_id")`,
    );

    // ─── work_order_labour ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "work_order_labour" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "work_order_id" uuid NOT NULL,
        "employee_id" uuid NOT NULL,
        "run_id" uuid NOT NULL,
        "run_line_id" uuid NOT NULL,
        "period" character(7) NOT NULL,
        "hours" numeric(7,2) NOT NULL,
        "rate" numeric(12,4) NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "account" character varying(4) NOT NULL,
        "cleared_to" character varying(7),
        "cleared_at" TIMESTAMP WITH TIME ZONE,
        "journal_entry_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_work_order_labour_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_work_order_labour_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_work_order_labour_work_order" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_work_order_labour_employee" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_work_order_labour_run" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_work_order_labour_run_line" FOREIGN KEY ("run_line_id") REFERENCES "payroll_run_lines"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_work_order_labour_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "CHK_work_order_labour_account" CHECK ("account" IN ('WIP', 'COGS')),
        CONSTRAINT "CHK_work_order_labour_cleared_to" CHECK ("cleared_to" IN ('COGS', 'EXPENSE'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_work_order_labour_work_order" ON "work_order_labour" ("work_order_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_work_order_labour_run" ON "work_order_labour" ("run_id")`,
    );

    // ─── 6390 Labour absorbed, across every tenant ─────────────────────────
    // Frozen as of this migration (mirrors CHART_OF_ACCOUNTS in @saas/shared).
    await queryRunner.query(`SELECT set_config('app.bypass_rls', 'on', true)`);
    await queryRunner.query(
      `INSERT INTO "ledger_accounts" ("tenant_id", "code", "name", "type", "role", "is_system", "description", "parent_id")
       SELECT t."tenant_id", '6390', 'Labour absorbed', 'EXPENSE'::"ledger_accounts_type_enum", 'LABOUR_ABSORBED', true,
              'Payroll cost charged to jobs (a credit): Salaries & wages net of this is labour not spent on jobs',
              (SELECT p."id" FROM "ledger_accounts" p
                WHERE p."tenant_id" = t."tenant_id" AND p."role" = 'SALARIES' AND p."deletedAt" IS NULL)
       FROM (SELECT DISTINCT "tenant_id" FROM "ledger_accounts") t
       WHERE NOT EXISTS (
         SELECT 1 FROM "ledger_accounts" x
         WHERE x."tenant_id" = t."tenant_id" AND (x."role" = 'LABOUR_ABSORBED' OR x."code" = '6390') AND x."deletedAt" IS NULL
       )`,
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
    // Policies go with their tables.
    await queryRunner.query(`DROP TABLE IF EXISTS "work_order_labour"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "timesheet_entries"`);

    await queryRunner.query(`
      ALTER TABLE "work_orders"
        DROP CONSTRAINT IF EXISTS "CHK_work_orders_labour_status",
        DROP COLUMN IF EXISTS "labour_status",
        DROP COLUMN IF EXISTS "labour_split"
    `);
    await queryRunner.query(`
      ALTER TABLE "payroll_settings"
        DROP CONSTRAINT IF EXISTS "CHK_payroll_settings_standard_hours",
        DROP COLUMN IF EXISTS "monthly_standard_hours"
    `);
    await queryRunner.query(`
      ALTER TABLE "payroll_runs"
        DROP CONSTRAINT IF EXISTS "FK_payroll_runs_labour_journal_entry",
        DROP CONSTRAINT IF EXISTS "FK_payroll_runs_labour_void_journal_entry",
        DROP COLUMN IF EXISTS "total_labour_absorbed",
        DROP COLUMN IF EXISTS "labour_journal_entry_id",
        DROP COLUMN IF EXISTS "labour_void_journal_entry_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "payroll_run_lines"
        DROP COLUMN IF EXISTS "standard_hours",
        DROP COLUMN IF EXISTS "logged_hours",
        DROP COLUMN IF EXISTS "direct_hours",
        DROP COLUMN IF EXISTS "labour_rate",
        DROP COLUMN IF EXISTS "labour_absorbed"
    `);

    // Soft-deleted, not removed: the ledger is append-only, and any journal
    // line that reached the account must keep it.
    await queryRunner.query(`SELECT set_config('app.bypass_rls', 'on', true)`);
    await queryRunner.query(
      `UPDATE "ledger_accounts" SET "deletedAt" = now()
        WHERE "is_system" AND "role" = 'LABOUR_ABSORBED' AND "deletedAt" IS NULL`,
    );
  }
}
