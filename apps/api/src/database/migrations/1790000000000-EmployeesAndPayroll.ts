import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Employees and payroll.
 *
 * - `employees`, `salary_packages`, `employee_advances`, `payroll_runs`,
 *   `payroll_run_lines`, `gratuity_ledger_entries`.
 * - Journal reference type PAYROLL.
 * - Four system ledger accounts backfilled to every existing tenant (new
 *   tenants get them from provisionChartOfAccounts): 1450 Employee advances,
 *   2300 Salaries payable, 2400 End-of-service provision, and 6310
 *   End-of-service gratuity under 6000. A tenant that already uses the code
 *   or the role is skipped for that account, as in 1789900000000.
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
    '1450',
    'Employee advances',
    'ASSET',
    'EMPLOYEE_ADVANCES',
    null,
    'Salary advances paid to employees and not yet recovered through payroll',
  ],
  [
    '2300',
    'Salaries payable',
    'LIABILITY',
    'SALARIES_PAYABLE',
    null,
    'Net pay from approved payroll runs not yet paid',
  ],
  [
    '2400',
    'End-of-service provision',
    'LIABILITY',
    'GRATUITY_PROVISION',
    null,
    'End-of-service gratuity earned by employees to date',
  ],
  [
    '6310',
    'End-of-service gratuity',
    'EXPENSE',
    'GRATUITY_EXPENSE',
    '6000',
    'Monthly change in the end-of-service provision',
  ],
];

const NEW_TENANT_TABLES: Array<[table: string, tenantColumn: string]> = [
  ['employees', 'tenant_id'],
  ['salary_packages', 'tenant_id'],
  ['employee_advances', 'tenant_id'],
  ['payroll_runs', 'tenant_id'],
  ['payroll_run_lines', 'tenant_id'],
  ['gratuity_ledger_entries', 'tenant_id'],
];

export class EmployeesAndPayroll1790000000000 implements MigrationInterface {
  name = 'EmployeesAndPayroll1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Postgres 12+ allows ADD VALUE inside a transaction; nothing later in
    // this migration uses the new value.
    await queryRunner.query(
      `ALTER TYPE "journal_entries_reference_type_enum" ADD VALUE IF NOT EXISTS 'PAYROLL'`,
    );

    // ─── employees ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "employees" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "tenant_id" uuid NOT NULL,
        "employee_number" character varying(40) NOT NULL,
        "first_name" character varying(120) NOT NULL,
        "last_name" character varying(120) NOT NULL,
        "job_title" character varying(120),
        "department" character varying(120),
        "user_id" uuid,
        "joining_date" date NOT NULL,
        "leaving_date" date,
        "status" character varying(20) NOT NULL DEFAULT 'ACTIVE',
        "nationality" character(2),
        "is_national" boolean NOT NULL DEFAULT false,
        "payment_method" character varying(10) NOT NULL,
        "bank_name" character varying(120),
        "iban_encrypted" text,
        "iban_last4" character varying(4),
        "email" character varying(255),
        "phone" character varying(40),
        CONSTRAINT "PK_employees_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_employees_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_employees_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "CHK_employees_status" CHECK ("status" IN ('ACTIVE', 'ON_HOLD', 'LEFT')),
        CONSTRAINT "CHK_employees_payment_method" CHECK ("payment_method" IN ('BANK', 'CASH'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_employees_tenant" ON "employees" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_employees_tenant_number" ON "employees" ("tenant_id", "employee_number") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_employees_tenant_user" ON "employees" ("tenant_id", "user_id") WHERE "user_id" IS NOT NULL AND "deletedAt" IS NULL`,
    );

    // ─── salary_packages ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "salary_packages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "employee_id" uuid NOT NULL,
        "effective_from" date NOT NULL,
        "basic" numeric(14,2) NOT NULL,
        "housing" numeric(14,2) NOT NULL,
        "transport" numeric(14,2) NOT NULL,
        "other_allowances" jsonb NOT NULL DEFAULT '[]',
        "created_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_salary_packages_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_salary_packages_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_salary_packages_employee" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_salary_packages_employee_from" ON "salary_packages" ("employee_id", "effective_from")`,
    );

    // ─── employee_advances ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "employee_advances" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "employee_id" uuid NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "issued_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "finance_account_id" uuid NOT NULL,
        "journal_entry_id" uuid NOT NULL,
        "note" text,
        "created_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_employee_advances_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_employee_advances_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_employee_advances_employee" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_employee_advances_finance_account" FOREIGN KEY ("finance_account_id") REFERENCES "finance_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_employee_advances_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);

    // ─── payroll_runs ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "payroll_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "run_number" character varying(40) NOT NULL,
        "period" character(7) NOT NULL,
        "pay_date" date NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'DRAFT',
        "total_salary_cost" numeric(14,2) NOT NULL DEFAULT 0,
        "total_overtime" numeric(14,2) NOT NULL DEFAULT 0,
        "total_bonus" numeric(14,2) NOT NULL DEFAULT 0,
        "total_unpaid_leave" numeric(14,2) NOT NULL DEFAULT 0,
        "total_advance_recovery" numeric(14,2) NOT NULL DEFAULT 0,
        "total_other_deductions" numeric(14,2) NOT NULL DEFAULT 0,
        "total_net" numeric(14,2) NOT NULL DEFAULT 0,
        "total_gratuity_accrual" numeric(14,2) NOT NULL DEFAULT 0,
        "bank_paid_at" TIMESTAMP WITH TIME ZONE,
        "cash_paid_at" TIMESTAMP WITH TIME ZONE,
        "approved_by_id" uuid,
        "approved_at" TIMESTAMP WITH TIME ZONE,
        "journal_entry_id" uuid,
        "void_journal_entry_id" uuid,
        "created_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payroll_runs_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payroll_runs_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_payroll_runs_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_payroll_runs_void_journal_entry" FOREIGN KEY ("void_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "CHK_payroll_runs_status" CHECK ("status" IN ('DRAFT', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'VOIDED'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_payroll_runs_tenant_period" ON "payroll_runs" ("tenant_id", "period") WHERE "status" <> 'VOIDED'`,
    );

    // ─── payroll_run_lines ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "payroll_run_lines" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "run_id" uuid NOT NULL,
        "employee_id" uuid NOT NULL,
        "employee_name" character varying(255) NOT NULL,
        "employee_number" character varying(40) NOT NULL,
        "payment_method" character varying(10) NOT NULL,
        "is_national" boolean NOT NULL DEFAULT false,
        "package_id" uuid,
        "basic" numeric(14,2) NOT NULL DEFAULT 0,
        "housing" numeric(14,2) NOT NULL DEFAULT 0,
        "transport" numeric(14,2) NOT NULL DEFAULT 0,
        "other_allowances" jsonb NOT NULL DEFAULT '[]',
        "gross" numeric(14,2) NOT NULL DEFAULT 0,
        "days_employed" integer NOT NULL,
        "days_in_month" integer NOT NULL,
        "prorated_gross" numeric(14,2) NOT NULL DEFAULT 0,
        "overtime_hours" numeric(7,2) NOT NULL DEFAULT 0,
        "overtime_hours_premium" numeric(7,2) NOT NULL DEFAULT 0,
        "overtime_amount" numeric(14,2) NOT NULL DEFAULT 0,
        "bonus_amount" numeric(14,2) NOT NULL DEFAULT 0,
        "bonus_label" character varying(120),
        "unpaid_leave_days" numeric(5,2) NOT NULL DEFAULT 0,
        "unpaid_leave_amount" numeric(14,2) NOT NULL DEFAULT 0,
        "advance_recovery" numeric(14,2) NOT NULL DEFAULT 0,
        "other_deduction_amount" numeric(14,2) NOT NULL DEFAULT 0,
        "other_deduction_label" character varying(120),
        "salary_cost" numeric(14,2) NOT NULL DEFAULT 0,
        "net_pay" numeric(14,2) NOT NULL DEFAULT 0,
        "gratuity_before" numeric(14,2),
        "gratuity_accrual" numeric(14,2),
        "gratuity_after" numeric(14,2),
        "flags" text[] NOT NULL DEFAULT '{}',
        "paid_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_payroll_run_lines_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payroll_run_lines_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_payroll_run_lines_run" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_payroll_run_lines_employee" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_payroll_run_lines_run_employee" ON "payroll_run_lines" ("run_id", "employee_id")`,
    );

    // ─── gratuity_ledger_entries ───────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "gratuity_ledger_entries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "employee_id" uuid NOT NULL,
        "kind" character varying(20) NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "as_of" date NOT NULL,
        "run_line_id" uuid,
        "journal_entry_id" uuid,
        "note" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_gratuity_ledger_entries_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_gratuity_ledger_entries_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_gratuity_ledger_entries_employee" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_gratuity_ledger_entries_run_line" FOREIGN KEY ("run_line_id") REFERENCES "payroll_run_lines"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_gratuity_ledger_entries_journal_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "CHK_gratuity_ledger_entries_kind" CHECK ("kind" IN ('OPENING', 'ACCRUAL', 'ADJUSTMENT', 'REVERSAL', 'SETTLEMENT'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_gratuity_ledger_employee" ON "gratuity_ledger_entries" ("tenant_id", "employee_id")`,
    );

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
    // Children first; policies go with their tables.
    await queryRunner.query(`DROP TABLE IF EXISTS "gratuity_ledger_entries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payroll_run_lines"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payroll_runs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "employee_advances"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "salary_packages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "employees"`);

    // Soft-deleted, not removed: the ledger is append-only, and any journal
    // line that reached these accounts must keep its account.
    await queryRunner.query(`SELECT set_config('app.bypass_rls','on',true)`);
    await queryRunner.query(
      `UPDATE "ledger_accounts" SET "deletedAt" = now()
        WHERE "is_system" AND "role" = ANY($1) AND "deletedAt" IS NULL`,
      [ACCOUNTS.map((a) => a[3])],
    );

    // Enum values cannot be dropped in Postgres: PAYROLL on
    // journal_entries_reference_type_enum stays (harmless with nothing
    // posting to it, and the entity can keep declaring it).
  }
}
