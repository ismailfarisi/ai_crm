import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves three ledger invariants from "the application is careful" into the
 * database, where a bug, a race or a hand-written INSERT cannot get past them.
 *
 * 1. **Single postings are unique.** An expense claim's accrual
 *    (`EXPENSE`, `<claim id>`), its reimbursement (`EXPENSE`,
 *    `<claim id>:reimbursement`) and an account's opening balance (`MANUAL`,
 *    `opening-balance:<account id>`) were each guarded by a read-then-insert
 *    check, which two concurrent requests can both pass. The partial unique
 *    index makes the second insert fail instead.
 *
 *    Partial, because other reference types legitimately carry several
 *    entries per reference: an invoice's payments and their voids
 *    (`INVOICE`), a month's revaluation and its reversal (`MANUAL`, the month
 *    label), a work order's stages, stock movements, bill payments. Declared
 *    on `JournalEntry` too, under the same name, so drift does not grow.
 *
 * 2. **Every entry balances.** `lines` is jsonb, so no column constraint can
 *    sum it. A BEFORE INSERT OR UPDATE trigger adds up the debits and credits
 *    as `numeric` — exact, never float — rounded to the cent exactly as the
 *    trial-balance check in CI does, and refuses the row if they differ.
 *    `LedgerService.resolveLines` already refuses unbalanced input; this
 *    catches anything that does not go through it.
 *
 * 3. **Entries are append-only.** Nothing in the application updates a posted
 *    entry — voids and revaluations post reversing entries — so an UPDATE is
 *    refused. DELETE stays allowed: deleting an organization cascades to its
 *    journal, and earlier migrations' `down()` remove the entries they wrote.
 *    A deliberate data fix can `ALTER TABLE "journal_entries" DISABLE TRIGGER
 *    journal_entries_append_only` inside its own migration.
 *
 * Existing rows are not re-validated by the triggers (they fire on writes
 * only). The unique index is, so the migration first looks for duplicates and
 * stops with the offending reference rather than a bare index error: deciding
 * which of two postings is the real one is an accounting call, not something
 * a migration should guess at.
 *
 * RLS: the policy on `journal_entries` is FORCE'd, so the duplicate check
 * turns on `app.bypass_rls` while it runs (restoring the previous value
 * after) to see every tenant's rows even when the migration role is the table
 * owner rather than a superuser. The index and triggers apply to all rows
 * regardless of policy, and need no grants: the app role reaches them only
 * through writes to the table it already has.
 */
export class EnforceLedgerIntegrity1789100000000 implements MigrationInterface {
  name = 'EnforceLedgerIntegrity1789100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── 1. single postings ──────────────────────────────────────────────
    await queryRunner.query(`
      DO $$
      DECLARE
        dup record;
        total integer;
        previous_bypass text := current_setting('app.bypass_rls', true);
      BEGIN
        PERFORM set_config('app.bypass_rls', 'on', true);

        SELECT COUNT(*) INTO total FROM (
          SELECT 1
          FROM "journal_entries"
          WHERE "referenceType" = 'EXPENSE'
             OR ("referenceType" = 'MANUAL' AND "referenceId" LIKE 'opening-balance:%')
          GROUP BY "tenantId", "referenceType", "referenceId"
          HAVING COUNT(*) > 1
        ) d;

        IF total > 0 THEN
          SELECT "tenantId", "referenceType", "referenceId", COUNT(*) AS n
          INTO dup
          FROM "journal_entries"
          WHERE "referenceType" = 'EXPENSE'
             OR ("referenceType" = 'MANUAL' AND "referenceId" LIKE 'opening-balance:%')
          GROUP BY "tenantId", "referenceType", "referenceId"
          HAVING COUNT(*) > 1
          ORDER BY "tenantId", "referenceId"
          LIMIT 1;

          RAISE EXCEPTION
            '% reference(s) were posted more than once; cannot add uq_journal_entries_single_posting',
            total
            USING DETAIL = format(
              'e.g. tenant %s, %s %s posted %s times',
              dup."tenantId", dup."referenceType", dup."referenceId", dup.n
            ),
            HINT = 'Reverse the extra postings (and their balance effect) by hand, delete the duplicates, then re-run the migration.';
        END IF;

        PERFORM set_config('app.bypass_rls', COALESCE(previous_bypass, ''), true);
      END
      $$;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_journal_entries_single_posting"
      ON "journal_entries" ("tenantId", "referenceType", "referenceId")
      WHERE "referenceType" = 'EXPENSE'
         OR ("referenceType" = 'MANUAL' AND "referenceId" LIKE 'opening-balance:%')
    `);

    // ─── 2. balanced entries ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "journal_entries_enforce_balance"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        difference numeric;
      BEGIN
        IF NEW."lines" IS NULL OR jsonb_typeof(NEW."lines") <> 'array' THEN
          RAISE EXCEPTION 'Journal entry % has no lines array', NEW."entryNumber"
            USING ERRCODE = 'check_violation';
        END IF;

        -- jsonb numbers are arbitrary-precision numerics, so ->> then ::numeric
        -- is exact; a missing or null side counts as zero. Rounded to the cent,
        -- the same comparison the CI trial-balance check makes.
        SELECT ROUND(
                 COALESCE(
                   SUM(COALESCE((line->>'debit')::numeric, 0)
                     - COALESCE((line->>'credit')::numeric, 0)),
                   0),
                 2)
        INTO difference
        FROM jsonb_array_elements(NEW."lines") AS line;

        IF difference <> 0 THEN
          RAISE EXCEPTION 'Journal entry % does not balance: debits minus credits is %',
            NEW."entryNumber", difference
            USING ERRCODE = 'check_violation';
        END IF;

        RETURN NEW;
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "journal_entries_enforce_balance"
      BEFORE INSERT OR UPDATE ON "journal_entries"
      FOR EACH ROW EXECUTE FUNCTION "journal_entries_enforce_balance"()
    `);

    // ─── 3. append-only ──────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "journal_entries_append_only"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'Journal entry % is posted and cannot be changed; post a reversing entry instead',
          OLD."entryNumber"
          USING ERRCODE = 'restrict_violation';
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "journal_entries_append_only"
      BEFORE UPDATE ON "journal_entries"
      FOR EACH ROW EXECUTE FUNCTION "journal_entries_append_only"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "journal_entries_append_only" ON "journal_entries"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "journal_entries_append_only"()`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "journal_entries_enforce_balance" ON "journal_entries"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "journal_entries_enforce_balance"()`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."uq_journal_entries_single_posting"`,
    );
  }
}
