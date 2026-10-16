import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * UAE payroll compliance: leave, pension, final settlement and WPS.
 *
 * - `payroll_settings`, `pension_schemes`, `leave_records`, `settlements`,
 *   `settlement_lines`, `leave_ledger_entries`, `pension_remittances`.
 * - Employee WPS, pension, leave-override and probation columns; run leave,
 *   pension and leave-provision totals; run-line half pay, leave, pension and
 *   leave-provision columns; `gratuity_ledger_entries.settlement_id`.
 * - Journal reference types SETTLEMENT and PENSION_REMITTANCE.
 * - Four system ledger accounts backfilled to every existing tenant (new
 *   tenants get them from provisionChartOfAccounts): 2410 Leave salary
 *   provision, 2420 Pension contributions payable, and 6320 Leave salary
 *   expense and 6330 Employer pension contribution under 6000. A tenant that
 *   already uses the code or the role is skipped for that account, as in
 *   1790000000000.
 *
 * Foreign keys and CHECK constraints live here rather than on the entities
 * (the drift check ignores FK_ / CHK_ constraints). Every new table is
 * tenant-isolated by RLS like every other tenant table.
 */

/** Frozen as of this migration (mirrors CHART_OF_ACCOUNTS in @saas/shared). */
const ACCOUNTS: Array<
  [
    code: string,
    name: string,
    type: 'ASSET' | 'LIABILITY' | 'EXPENSE',
    role: string,
    parent: string | null,
    description: string,
  ]
> = [
  [
    '2410',
    'Leave salary provision',
    'LIABILITY',
    'LEAVE_PROVISION',
    null,
    'Annual leave earned by employees and not yet taken or paid out',
  ],
  [
    '2420',
    'Pension contributions payable',
    'LIABILITY',
    'PENSION_PAYABLE',
    null,
    'Employee and employer pension contributions not yet remitted to the fund',
  ],
  [
    '6320',
    'Leave salary expense',
    'EXPENSE',
    'LEAVE_EXPENSE',
    '6000',
    'Monthly change in the leave salary provision',
  ],
  [
    '6330',
    'Employer pension contribution',
    'EXPENSE',
    'PENSION_EXPENSE',
    '6000',
    "The employer's share of nationals' pension contributions",
  ],
];

const NEW_TENANT_TABLES: Array<[table: string, tenantColumn: string]> = [
  ['payroll_settings', 'tenant_id'],
  ['pension_schemes', 'tenant_id'],
  ['leave_records', 'tenant_id'],
  ['settlements', 'tenant_id'],
  ['settlement_lines', 'tenant_id'],
  ['leave_ledger_entries', 'tenant_id'],
  ['pension_remittances', 'tenant_id'],
];

export class UaeCompliance1790100000000 implements MigrationInterface {
  name = 'UaeCompliance1790100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Postgres 12+ allows ADD VALUE inside a transaction; nothing later in
    // this migration uses the new values.
    await queryRunner.query(
      `ALTER TYPE "journal_entries_reference_type_enum" ADD VALUE IF NOT EXISTS 'SETTLEMENT'`,
    );
    await queryRunner.query(
      `ALTER TYPE "journal_entries_reference_type_enum" ADD VALUE IF NOT EXISTS 'PENSION_REMITTANCE'`,
    );

    // ─── payroll_settings ──────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "payroll_settings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "wps_enabled" boolean NOT NULL DEFAULT false,
        "employer_id_type" character varying(10),
        "employer_id" character varying(20),
        "payer_routing_code" character(9),
        "annual_leave_days" integer NOT NULL DEFAULT 30,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payroll_settings_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payroll_settings_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "CHK_payroll_settings_employer_id_type" CHECK ("employer_id_type" IN ('MOHRE', 'FREE_ZONE')),
        CONSTRAINT "CHK_payroll_settings_annual_leave_days" CHECK ("annual_leave_days" BETWEEN 30 AND 60)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_payroll_settings_tenant" ON "payroll_settings" ("tenant_id")`,
    );

    // ─── pension_schemes ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "pension_schemes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "preset_key" character varying(40),
        "employee_pct" numeric(5,2) NOT NULL,
        "employer_pct" numeric(5,2) NOT NULL,
        "base" character varying(20) NOT NULL,
        "min_salary" numeric(14,2),
        "max_salary" numeric(14,2),
        "is_active" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pension_schemes_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pension_schemes_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "CHK_pension_schemes_base" CHECK ("base" IN ('BASIC', 'BASIC_HOUSING', 'GROSS'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_pension_schemes_tenant" ON "pension_schemes" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_pension_schemes_tenant_preset" ON "pension_schemes" ("tenant_id", "preset_key") WHERE "preset_key" IS NOT NULL`,
    );

    // ─── leave_records ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "leave_records" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "employee_id" uuid NOT NULL,
        "type" character varying(20) NOT NULL,
        "start_date" date NOT NULL,
        "end_date" date NOT NULL,
        "days" numeric(5,1) NOT NULL,
        "note" text,
        "created_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_leave_records_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_leave_records_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_leave_records_employee" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "CHK_leave_records_type" CHECK ("type" IN ('ANNUAL', 'SICK', 'UNPAID', 'MATERNITY', 'OTHER_PAID')),
        CONSTRAINT "CHK_leave_records_dates" CHECK ("end_date" >= "start_date"),
        CONSTRAINT "CHK_leave_records_days" CHECK ("days" > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_leave_records_employee" ON "leave_records" ("tenant_id", "employee_id")`,
    );

    // ─── settlements ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "settlements" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "settlement_number" character varying(40) NOT NULL,
        "employee_id" uuid NOT NULL,
        "employee_name" character varying(255) NOT NULL,
        "leaving_date" date NOT NULL,
        "reason" character varying(20) NOT NULL,
        "service_days" integer NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'DRAFT',
        "basic" numeric(14,2) NOT NULL DEFAULT 0,
        "gross" numeric(14,2) NOT NULL DEFAULT 0,
        "leave_balance_days" numeric(7,2) NOT NULL DEFAULT 0,
        "net_pay" numeric(14,2) NOT NULL DEFAULT 0,
        "payment_method" character varying(10) NOT NULL,
        "finance_account_id" uuid,
        "paid_at" TIMESTAMP WITH TIME ZONE,
        "journal_entry_id" uuid,
        "payment_journal_entry_id" uuid,
        "void_journal_entry_id" uuid,
        "approved_by_id" uuid,
        "approved_at" TIMESTAMP WITH TIME ZONE,
        "created_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_settlements_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_settlements_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_settlements_employee" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_settlements_finance_account" FOREIGN KEY ("finance_account_id") REFERENCES "finance_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_settlements_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_settlements_payment_journal_entry" FOREIGN KEY ("payment_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_settlements_void_journal_entry" FOREIGN KEY ("void_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "CHK_settlements_status" CHECK ("status" IN ('DRAFT', 'APPROVED', 'PAID', 'VOIDED')),
        CONSTRAINT "CHK_settlements_reason" CHECK ("reason" IN ('RESIGNATION', 'TERMINATION', 'END_OF_CONTRACT', 'DEATH', 'OTHER'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_settlements_tenant_number" ON "settlements" ("tenant_id", "settlement_number")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_settlements_live_employee" ON "settlements" ("tenant_id", "employee_id") WHERE "status" <> 'VOIDED'`,
    );

    // ─── settlement_lines ──────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "settlement_lines" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "settlement_id" uuid NOT NULL,
        "kind" character varying(20) NOT NULL,
        "label" character varying(160) NOT NULL,
        "quantity" numeric(7,2),
        "rate" numeric(14,4),
        "amount" numeric(14,2) NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_settlement_lines_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_settlement_lines_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_settlement_lines_settlement" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "CHK_settlement_lines_kind" CHECK ("kind" IN ('GRATUITY', 'LEAVE_ENCASHMENT', 'NOTICE_PAY', 'ADVANCE_RECOVERY', 'ADDITION', 'DEDUCTION'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_settlement_lines_settlement" ON "settlement_lines" ("settlement_id")`,
    );

    // ─── leave_ledger_entries ──────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "leave_ledger_entries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "employee_id" uuid NOT NULL,
        "kind" character varying(20) NOT NULL,
        "days" numeric(7,2) NOT NULL,
        "amount" numeric(14,2),
        "as_of" date NOT NULL,
        "run_line_id" uuid,
        "settlement_id" uuid,
        "journal_entry_id" uuid,
        "note" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_leave_ledger_entries_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_leave_ledger_entries_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_leave_ledger_entries_employee" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_leave_ledger_entries_run_line" FOREIGN KEY ("run_line_id") REFERENCES "payroll_run_lines"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_leave_ledger_entries_settlement" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_leave_ledger_entries_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "CHK_leave_ledger_entries_kind" CHECK ("kind" IN ('OPENING', 'ACCRUAL', 'TAKEN', 'ADJUSTMENT', 'ENCASHMENT', 'REVERSAL'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_leave_ledger_employee" ON "leave_ledger_entries" ("tenant_id", "employee_id")`,
    );

    // ─── pension_remittances ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "pension_remittances" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "period" character(7) NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "finance_account_id" uuid NOT NULL,
        "paid_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "journal_entry_id" uuid NOT NULL,
        "void_journal_entry_id" uuid,
        "voided_at" TIMESTAMP WITH TIME ZONE,
        "created_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pension_remittances_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pension_remittances_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_pension_remittances_finance_account" FOREIGN KEY ("finance_account_id") REFERENCES "finance_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_pension_remittances_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_pension_remittances_void_journal_entry" FOREIGN KEY ("void_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_pension_remittances_live" ON "pension_remittances" ("tenant_id", "period") WHERE "voided_at" IS NULL`,
    );

    // ─── columns on existing tables ────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "employees"
        ADD COLUMN "wps_person_id" character varying(14),
        ADD COLUMN "bank_routing_code" character(9),
        ADD COLUMN "pension_scheme_id" uuid,
        ADD COLUMN "annual_leave_days_override" integer,
        ADD COLUMN "probation_end_date" date,
        ADD CONSTRAINT "FK_employees_pension_scheme" FOREIGN KEY ("pension_scheme_id") REFERENCES "pension_schemes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "payroll_runs"
        ADD COLUMN "total_half_pay" numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN "total_pension_employee" numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN "total_pension_employer" numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN "total_leave_provision" numeric(14,2) NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "payroll_run_lines"
        ADD COLUMN "half_pay_days" numeric(5,2) NOT NULL DEFAULT 0,
        ADD COLUMN "half_pay_amount" numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN "annual_leave_days" numeric(5,2) NOT NULL DEFAULT 0,
        ADD COLUMN "leave_days_in_period" numeric(5,2) NOT NULL DEFAULT 0,
        ADD COLUMN "leave_overridden" boolean NOT NULL DEFAULT false,
        ADD COLUMN "pension_scheme_id" uuid,
        ADD COLUMN "pension_scheme_name" character varying(120),
        ADD COLUMN "pension_base" numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN "pension_employee" numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN "pension_employer" numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN "leave_provision_before" numeric(14,2),
        ADD COLUMN "leave_provision_change" numeric(14,2),
        ADD COLUMN "leave_provision_after" numeric(14,2)
    `);
    await queryRunner.query(`
      ALTER TABLE "gratuity_ledger_entries"
        ADD COLUMN "settlement_id" uuid,
        ADD CONSTRAINT "FK_gratuity_ledger_entries_settlement" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
    `);

    // ─── ledger accounts, across every tenant ──────────────────────────────
    await queryRunner.query(`SELECT set_config('app.bypass_rls','on',true)`);
    for (const [code, name, type, role, parent, description] of ACCOUNTS) {
      await queryRunner.query(
        `INSERT INTO "ledger_accounts" ("tenant_id", "code", "name", "type", "role", "is_system", "description", "parent_id")
         SELECT t."tenant_id", $1::varchar, $2::varchar, $3::"ledger_accounts_type_enum", $4::varchar, true, $5::text,
                (SELECT p."id" FROM "ledger_accounts" p
                  WHERE p."tenant_id" = t."tenant_id" AND p."code" = $6::varchar AND p."role" = 'OPERATING_EXPENSE' AND p."deletedAt" IS NULL)
         FROM (SELECT DISTINCT "tenant_id" FROM "ledger_accounts") t
         WHERE NOT EXISTS (
           SELECT 1 FROM "ledger_accounts" x
           WHERE x."tenant_id" = t."tenant_id" AND (x."role" = $4::varchar OR x."code" = $1::varchar) AND x."deletedAt" IS NULL
         )`,
        [code, name, type, role, description, parent],
      );
    }

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
    await queryRunner.query(
      `ALTER TABLE "gratuity_ledger_entries" DROP CONSTRAINT IF EXISTS "FK_gratuity_ledger_entries_settlement"`,
    );
    await queryRunner.query(
      `ALTER TABLE "gratuity_ledger_entries" DROP COLUMN IF EXISTS "settlement_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE "payroll_run_lines"
        DROP COLUMN IF EXISTS "half_pay_days",
        DROP COLUMN IF EXISTS "half_pay_amount",
        DROP COLUMN IF EXISTS "annual_leave_days",
        DROP COLUMN IF EXISTS "leave_days_in_period",
        DROP COLUMN IF EXISTS "leave_overridden",
        DROP COLUMN IF EXISTS "pension_scheme_id",
        DROP COLUMN IF EXISTS "pension_scheme_name",
        DROP COLUMN IF EXISTS "pension_base",
        DROP COLUMN IF EXISTS "pension_employee",
        DROP COLUMN IF EXISTS "pension_employer",
        DROP COLUMN IF EXISTS "leave_provision_before",
        DROP COLUMN IF EXISTS "leave_provision_change",
        DROP COLUMN IF EXISTS "leave_provision_after"
    `);
    await queryRunner.query(`
      ALTER TABLE "payroll_runs"
        DROP COLUMN IF EXISTS "total_half_pay",
        DROP COLUMN IF EXISTS "total_pension_employee",
        DROP COLUMN IF EXISTS "total_pension_employer",
        DROP COLUMN IF EXISTS "total_leave_provision"
    `);
    await queryRunner.query(
      `ALTER TABLE "employees" DROP CONSTRAINT IF EXISTS "FK_employees_pension_scheme"`,
    );
    await queryRunner.query(`
      ALTER TABLE "employees"
        DROP COLUMN IF EXISTS "wps_person_id",
        DROP COLUMN IF EXISTS "bank_routing_code",
        DROP COLUMN IF EXISTS "pension_scheme_id",
        DROP COLUMN IF EXISTS "annual_leave_days_override",
        DROP COLUMN IF EXISTS "probation_end_date"
    `);

    // Children first; policies go with their tables.
    await queryRunner.query(`DROP TABLE IF EXISTS "pension_remittances"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "leave_ledger_entries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "settlement_lines"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "settlements"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "leave_records"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "pension_schemes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payroll_settings"`);

    // Soft-deleted, not removed: the ledger is append-only, and any journal
    // line that reached these accounts must keep its account.
    await queryRunner.query(`SELECT set_config('app.bypass_rls','on',true)`);
    await queryRunner.query(
      `UPDATE "ledger_accounts" SET "deletedAt" = now()
        WHERE "is_system" AND "role" = ANY($1) AND "deletedAt" IS NULL`,
      [ACCOUNTS.map((a) => a[3])],
    );

    // Enum values cannot be dropped in Postgres: SETTLEMENT and
    // PENSION_REMITTANCE on journal_entries_reference_type_enum stay
    // (harmless with nothing posting to them, and the entity can keep
    // declaring them).
  }
}
