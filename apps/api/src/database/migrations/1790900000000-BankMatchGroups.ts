import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bank reconciliation matches become groups.
 *
 * A statement line used to carry one `journal_entry_id`, so a deposit of
 * three cheques or a payroll paid out as twenty transfers could not be
 * reconciled. A match is now its own row: any number of statement lines
 * (`bank_statement_lines.match_id`) against any number of journal entries
 * (`bank_match_entries`), whose totals the service checks agree.
 *
 * Every existing match becomes a group of one line and one entry, reusing
 * the line's id as the match's. A line left MATCHED after its entry was
 * deleted (the old foreign key set it to null) had nothing to match, and is
 * reopened.
 */
export class BankMatchGroups1790900000000 implements MigrationInterface {
  name = 'BankMatchGroups1790900000000';

  private async isolate(
    queryRunner: QueryRunner,
    table: string,
  ): Promise<void> {
    await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(
      `CREATE POLICY tenant_isolation_policy ON "${table}" FOR ALL ` +
        `USING (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
        `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`,
    );
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "bank_matches" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "finance_account_id" uuid NOT NULL,
        "matched_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "matched_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bank_matches_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_bank_matches_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_bank_matches_account" FOREIGN KEY ("finance_account_id") REFERENCES "finance_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_bank_matches_account" ON "bank_matches" ("tenant_id", "finance_account_id")`,
    );
    await this.isolate(queryRunner, 'bank_matches');

    // An entry is reconciled at most once per account. NO ACTION rather than
    // CASCADE on the entry: deleting a reconciled entry should fail loudly,
    // not quietly leave a match whose sides no longer agree.
    await queryRunner.query(`
      CREATE TABLE "bank_match_entries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "match_id" uuid NOT NULL,
        "finance_account_id" uuid NOT NULL,
        "journal_entry_id" uuid NOT NULL,
        CONSTRAINT "PK_bank_match_entries_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_bank_match_entries_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_bank_match_entries_match" FOREIGN KEY ("match_id") REFERENCES "bank_matches"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_bank_match_entries_account" FOREIGN KEY ("finance_account_id") REFERENCES "finance_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_bank_match_entries_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_bank_match_entries_match" ON "bank_match_entries" ("match_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_bank_match_entries_entry" ON "bank_match_entries" ("finance_account_id", "journal_entry_id")`,
    );
    await this.isolate(queryRunner, 'bank_match_entries');

    await queryRunner.query(`
      ALTER TABLE "bank_statement_lines"
        ADD COLUMN "match_id" uuid,
        ADD CONSTRAINT "FK_bank_statement_lines_match" FOREIGN KEY ("match_id") REFERENCES "bank_matches"("id") ON DELETE SET NULL ON UPDATE NO ACTION
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_bank_statement_lines_match" ON "bank_statement_lines" ("match_id")`,
    );

    // ─── carry existing matches across ─────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO "bank_matches" ("id", "tenant_id", "finance_account_id", "matched_at", "matched_by_id")
      SELECT "id", "tenant_id", "finance_account_id", COALESCE("matched_at", now()), "matched_by_id"
      FROM "bank_statement_lines" WHERE "journal_entry_id" IS NOT NULL
    `);
    await queryRunner.query(`
      INSERT INTO "bank_match_entries" ("tenant_id", "match_id", "finance_account_id", "journal_entry_id")
      SELECT "tenant_id", "id", "finance_account_id", "journal_entry_id"
      FROM "bank_statement_lines" WHERE "journal_entry_id" IS NOT NULL
    `);
    await queryRunner.query(
      `UPDATE "bank_statement_lines" SET "match_id" = "id" WHERE "journal_entry_id" IS NOT NULL`,
    );
    await queryRunner.query(`
      UPDATE "bank_statement_lines"
      SET "status" = 'UNMATCHED', "matched_at" = NULL, "matched_by_id" = NULL
      WHERE "status" = 'MATCHED' AND "match_id" IS NULL
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_bank_statement_lines_entry"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bank_statement_lines" DROP CONSTRAINT IF EXISTS "FK_bank_statement_lines_entry"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bank_statement_lines" DROP COLUMN "journal_entry_id"`,
    );

    // Matched exactly when it belongs to a match. Deleting a match whose lines
    // still say MATCHED therefore fails, rather than leaving them orphaned.
    await queryRunner.query(`
      ALTER TABLE "bank_statement_lines"
        ADD CONSTRAINT "CHK_bank_statement_lines_match" CHECK (("status" = 'MATCHED') = ("match_id" IS NOT NULL))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bank_statement_lines" DROP CONSTRAINT IF EXISTS "CHK_bank_statement_lines_match"`,
    );
    await queryRunner.query(`
      ALTER TABLE "bank_statement_lines"
        ADD COLUMN "journal_entry_id" uuid,
        ADD CONSTRAINT "FK_bank_statement_lines_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE NO ACTION
    `);
    // Only a one-line, one-entry match fits the old shape; anything bigger
    // is reopened.
    await queryRunner.query(`
      UPDATE "bank_statement_lines" l
      SET "journal_entry_id" = e."journal_entry_id"
      FROM "bank_match_entries" e
      WHERE e."match_id" = l."match_id"
        AND (SELECT count(*) FROM "bank_match_entries" x WHERE x."match_id" = l."match_id") = 1
        AND (SELECT count(*) FROM "bank_statement_lines" y WHERE y."match_id" = l."match_id") = 1
    `);
    await queryRunner.query(`
      UPDATE "bank_statement_lines"
      SET "status" = 'UNMATCHED', "matched_at" = NULL, "matched_by_id" = NULL
      WHERE "status" = 'MATCHED' AND "journal_entry_id" IS NULL
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_bank_statement_lines_entry" ON "bank_statement_lines" ("finance_account_id", "journal_entry_id") WHERE "journal_entry_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_bank_statement_lines_match"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bank_statement_lines" DROP CONSTRAINT IF EXISTS "FK_bank_statement_lines_match"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bank_statement_lines" DROP COLUMN "match_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "bank_match_entries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bank_matches"`);
  }
}
