import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What a business needs before these books can be its only books.
 *
 * 1. **Period lock.** `organizations.books_locked_through` and a BEFORE INSERT
 *    trigger on `journal_entries` that refuses any entry dated on or before
 *    it. A trigger rather than a check in each service, because some
 *    twenty-five places post entries — documents, payroll, Temporal
 *    activities — and a lock that one of them forgets is not a lock. Dates
 *    compare in UTC, as every report's date range does. The SQLSTATE is
 *    `KB001` (`PERIOD_LOCKED_SQLSTATE` in @saas/shared), which the exception
 *    filter answers with a 409 carrying the trigger's message. `organizations`
 *    has no RLS, so the lookup needs nothing from the session.
 *
 * 2. **Manual journals.** `memo`, `created_by_id` and `reverses_entry_id` on
 *    `journal_entries`, with at most one reversal per entry. Adding nullable
 *    columns rewrites no rows, so the append-only trigger does not fire.
 *
 * 3. **Reverse charge.** `supplier_bills.reverse_charge_tax`: the VAT the
 *    buyer self-assessed, fixed at approval so a return can be reproduced
 *    after a code's rate changes.
 *
 * 4. **Bank reconciliation.** `bank_statement_lines`, one per line of an
 *    imported statement, each matched to at most one journal entry per
 *    account. `fingerprint` makes re-importing an overlapping statement
 *    harmless. Tenant-isolated by RLS like every other tenant table.
 */
export class AccountingCore1790500000000 implements MigrationInterface {
  name = 'AccountingCore1790500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── 1. period lock ──────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "organizations"
        ADD COLUMN "books_locked_through" date,
        ADD COLUMN "books_locked_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "books_locked_by_id" uuid
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "journal_entries_period_lock"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        locked_through date;
      BEGIN
        SELECT "books_locked_through" INTO locked_through
        FROM "organizations" WHERE "id" = NEW."tenantId";

        IF locked_through IS NOT NULL
           AND (NEW."entryDate" AT TIME ZONE 'UTC')::date <= locked_through THEN
          RAISE EXCEPTION 'The books are locked through %. % is dated %; date it after the lock, or ask a finance admin to reopen the period.',
            to_char(locked_through, 'YYYY-MM-DD'),
            NEW."entryNumber",
            to_char(NEW."entryDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD')
            USING ERRCODE = 'KB001';
        END IF;

        RETURN NEW;
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "journal_entries_period_lock"
      BEFORE INSERT ON "journal_entries"
      FOR EACH ROW EXECUTE FUNCTION "journal_entries_period_lock"()
    `);

    // ─── 2. manual journals ──────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "journal_entries"
        ADD COLUMN "memo" character varying(500),
        ADD COLUMN "created_by_id" uuid,
        ADD COLUMN "reverses_entry_id" uuid,
        ADD CONSTRAINT "FK_journal_entries_reverses" FOREIGN KEY ("reverses_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_journal_entries_reverses"
      ON "journal_entries" ("reverses_entry_id")
      WHERE "reverses_entry_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_journal_entries_tenant_date"
      ON "journal_entries" ("tenantId", "entryDate")
    `);

    // ─── 3. reverse charge ───────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "supplier_bills"
        ADD COLUMN "reverse_charge_tax" numeric(12,2) NOT NULL DEFAULT 0
    `);

    // ─── 4. bank reconciliation ──────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "bank_statement_lines" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "finance_account_id" uuid NOT NULL,
        "statement_date" date NOT NULL,
        "description" character varying(255) NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "reference" character varying(100),
        "fingerprint" character varying(64) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'UNMATCHED',
        "journal_entry_id" uuid,
        "matched_at" TIMESTAMP WITH TIME ZONE,
        "matched_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bank_statement_lines_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_bank_statement_lines_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_bank_statement_lines_account" FOREIGN KEY ("finance_account_id") REFERENCES "finance_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_bank_statement_lines_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "CHK_bank_statement_lines_status" CHECK ("status" IN ('UNMATCHED', 'MATCHED', 'EXCLUDED'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_bank_statement_lines_account" ON "bank_statement_lines" ("tenant_id", "finance_account_id", "statement_date")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_bank_statement_lines_fingerprint" ON "bank_statement_lines" ("tenant_id", "finance_account_id", "fingerprint")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_bank_statement_lines_entry" ON "bank_statement_lines" ("finance_account_id", "journal_entry_id") WHERE "journal_entry_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "bank_statement_lines" ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE "bank_statement_lines" FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `CREATE POLICY tenant_isolation_policy ON "bank_statement_lines" FOR ALL ` +
        `USING (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
        `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "bank_statement_lines"`);
    await queryRunner.query(
      `ALTER TABLE "supplier_bills" DROP COLUMN IF EXISTS "reverse_charge_tax"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_journal_entries_tenant_date"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."uq_journal_entries_reverses"`,
    );
    await queryRunner.query(`
      ALTER TABLE "journal_entries"
        DROP CONSTRAINT IF EXISTS "FK_journal_entries_reverses",
        DROP COLUMN IF EXISTS "reverses_entry_id",
        DROP COLUMN IF EXISTS "created_by_id",
        DROP COLUMN IF EXISTS "memo"
    `);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "journal_entries_period_lock" ON "journal_entries"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "journal_entries_period_lock"()`,
    );
    await queryRunner.query(`
      ALTER TABLE "organizations"
        DROP COLUMN IF EXISTS "books_locked_by_id",
        DROP COLUMN IF EXISTS "books_locked_at",
        DROP COLUMN IF EXISTS "books_locked_through"
    `);
  }
}
