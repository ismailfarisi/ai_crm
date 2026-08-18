import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFinanceTables1786060000000 implements MigrationInterface {
  name = 'CreateFinanceTables1786060000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── Enums ─────────────────────────────────────────────────────────────
    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "finance_accounts_account_type_enum" AS ENUM('BANK', 'CASH', 'CREDIT_CARD', 'CLEARING');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "expense_claims_status_enum" AS ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'PAID', 'REJECTED');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "category_budgets_period_enum" AS ENUM('MONTHLY', 'QUARTERLY', 'ANNUAL');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "recurring_expenses_billing_interval_enum" AS ENUM('MONTHLY', 'ANNUAL');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "recurring_expenses_status_enum" AS ENUM('ACTIVE', 'PAUSED', 'CANCELLED');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "journal_entries_reference_type_enum" AS ENUM('EXPENSE', 'INVOICE', 'TRANSFER', 'MANUAL');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );

    // ─── finance_accounts ──────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "finance_accounts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenantId" uuid NOT NULL,
        "name" character varying(255) NOT NULL,
        "accountType" "finance_accounts_account_type_enum" NOT NULL DEFAULT 'BANK',
        "currency" character varying(10) NOT NULL DEFAULT 'USD',
        "balance" numeric(14,2) NOT NULL DEFAULT '0',
        "accountNumber" character varying(100),
        "isDefault" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_accounts_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_finance_accounts_tenant_id" ON "finance_accounts" ("tenantId")`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        ALTER TABLE "finance_accounts" ADD CONSTRAINT "FK_finance_accounts_tenant_id" FOREIGN KEY ("tenantId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );

    // ─── expense_claims ────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "expense_claims" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenantId" uuid NOT NULL,
        "claimNumber" character varying(100) NOT NULL,
        "employeeId" character varying(255) NOT NULL,
        "employeeName" character varying(255) NOT NULL,
        "category" character varying(100) NOT NULL,
        "amount" numeric(14,2) NOT NULL DEFAULT '0',
        "currency" character varying(10) NOT NULL DEFAULT 'USD',
        "status" "expense_claims_status_enum" NOT NULL DEFAULT 'DRAFT',
        "merchantName" character varying(255),
        "expenseDate" TIMESTAMP WITH TIME ZONE NOT NULL,
        "receiptUrl" text,
        "rejectionReason" text,
        "approvedById" character varying(255),
        "approvedAt" TIMESTAMP WITH TIME ZONE,
        "reimbursedAt" TIMESTAMP WITH TIME ZONE,
        "temporalWorkflowId" character varying(150),
        "items" jsonb NOT NULL DEFAULT '[]',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_expense_claims_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_expense_claims_tenant_id" ON "expense_claims" ("tenantId")`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        ALTER TABLE "expense_claims" ADD CONSTRAINT "FK_expense_claims_tenant_id" FOREIGN KEY ("tenantId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );

    // ─── category_budgets ──────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "category_budgets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenantId" uuid NOT NULL,
        "category" character varying(100) NOT NULL,
        "period" "category_budgets_period_enum" NOT NULL DEFAULT 'MONTHLY',
        "budgetAmount" numeric(14,2) NOT NULL DEFAULT '0',
        "spentAmount" numeric(14,2) NOT NULL DEFAULT '0',
        "alertThresholdPercent" numeric(5,2) NOT NULL DEFAULT '80',
        "startDate" TIMESTAMP WITH TIME ZONE NOT NULL,
        "endDate" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_category_budgets_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_category_budgets_tenant_id" ON "category_budgets" ("tenantId")`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        ALTER TABLE "category_budgets" ADD CONSTRAINT "FK_category_budgets_tenant_id" FOREIGN KEY ("tenantId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );

    // ─── recurring_expenses ────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "recurring_expenses" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenantId" uuid NOT NULL,
        "vendorName" character varying(255) NOT NULL,
        "category" character varying(100) NOT NULL,
        "amount" numeric(14,2) NOT NULL DEFAULT '0',
        "billingInterval" "recurring_expenses_billing_interval_enum" NOT NULL DEFAULT 'MONTHLY',
        "nextBillingDate" TIMESTAMP WITH TIME ZONE NOT NULL,
        "financeAccountId" uuid,
        "status" "recurring_expenses_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_recurring_expenses_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_recurring_expenses_tenant_id" ON "recurring_expenses" ("tenantId")`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        ALTER TABLE "recurring_expenses" ADD CONSTRAINT "FK_recurring_expenses_tenant_id" FOREIGN KEY ("tenantId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        ALTER TABLE "recurring_expenses" ADD CONSTRAINT "FK_recurring_expenses_finance_account_id" FOREIGN KEY ("financeAccountId") REFERENCES "finance_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );

    // ─── journal_entries ───────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "journal_entries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenantId" uuid NOT NULL,
        "entryNumber" character varying(100) NOT NULL,
        "referenceType" "journal_entries_reference_type_enum" NOT NULL DEFAULT 'MANUAL',
        "referenceId" character varying(255) NOT NULL,
        "entryDate" TIMESTAMP WITH TIME ZONE NOT NULL,
        "lines" jsonb NOT NULL DEFAULT '[]',
        "totalAmount" numeric(14,2) NOT NULL DEFAULT '0',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_journal_entries_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_journal_entries_tenant_id" ON "journal_entries" ("tenantId")`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        ALTER TABLE "journal_entries" ADD CONSTRAINT "FK_journal_entries_tenant_id" FOREIGN KEY ("tenantId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop journal_entries
    await queryRunner.query(
      `ALTER TABLE "journal_entries" DROP CONSTRAINT "FK_journal_entries_tenant_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_journal_entries_tenant_id"`,
    );
    await queryRunner.query(`DROP TABLE "journal_entries"`);
    await queryRunner.query(
      `DROP TYPE "public"."journal_entries_reference_type_enum"`,
    );

    // Drop recurring_expenses
    await queryRunner.query(
      `ALTER TABLE "recurring_expenses" DROP CONSTRAINT "FK_recurring_expenses_finance_account_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recurring_expenses" DROP CONSTRAINT "FK_recurring_expenses_tenant_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_recurring_expenses_tenant_id"`,
    );
    await queryRunner.query(`DROP TABLE "recurring_expenses"`);
    await queryRunner.query(
      `DROP TYPE "public"."recurring_expenses_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."recurring_expenses_billing_interval_enum"`,
    );

    // Drop category_budgets
    await queryRunner.query(
      `ALTER TABLE "category_budgets" DROP CONSTRAINT "FK_category_budgets_tenant_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_category_budgets_tenant_id"`,
    );
    await queryRunner.query(`DROP TABLE "category_budgets"`);
    await queryRunner.query(
      `DROP TYPE "public"."category_budgets_period_enum"`,
    );

    // Drop expense_claims
    await queryRunner.query(
      `ALTER TABLE "expense_claims" DROP CONSTRAINT "FK_expense_claims_tenant_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_expense_claims_tenant_id"`,
    );
    await queryRunner.query(`DROP TABLE "expense_claims"`);
    await queryRunner.query(
      `DROP TYPE "public"."expense_claims_status_enum"`,
    );

    // Drop finance_accounts
    await queryRunner.query(
      `ALTER TABLE "finance_accounts" DROP CONSTRAINT "FK_finance_accounts_tenant_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_finance_accounts_tenant_id"`,
    );
    await queryRunner.query(`DROP TABLE "finance_accounts"`);
    await queryRunner.query(
      `DROP TYPE "public"."finance_accounts_account_type_enum"`,
    );
  }
}
