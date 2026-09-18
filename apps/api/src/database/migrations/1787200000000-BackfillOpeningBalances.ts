import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Puts the opening balances of accounts created before the fix into the books.
 *
 * A cash account's opening balance used to be held on the account row and
 * never posted, so treasury and the ledger reported different figures for the
 * same account: Meridian's operating account read 15,530 in treasury against
 * 530 in the ledger — the 15,000 it was opened with. `FinanceService.createAccount`
 * posts the entry now, but accounts opened before that were left as they were,
 * and nothing about them would ever repair itself.
 *
 * What this does, per cash account that has no opening-balance entry already:
 * compares the balance the account carries against what the ledger says it
 * holds, and posts the difference — debit the cash account, credit opening
 * balance equity — so the two agree and the account can be reconciled against
 * a statement. Equity rather than income, because money the tenant already had
 * is not revenue earned here.
 *
 * Deliberate properties:
 *
 * - **Idempotent.** Keyed on `opening-balance:<accountId>`, the same reference
 *   the service uses, so an account that already has one is skipped and a
 *   re-run posts nothing.
 * - **Only the difference.** An account whose ledger already agrees with its
 *   balance gets nothing, so a tenant who has been posting correctly all along
 *   is untouched.
 * - **Balanced.** Every row posts two lines of equal value, so the trial
 *   balance is still zero afterwards — which is what CI asserts.
 * - **Dated to the account.** The entry carries the account's own creation
 *   date, not today's, so last month's reports do not move.
 *
 * Reversing drops exactly the entries it created and nothing else.
 */
export class BackfillOpeningBalances1787200000000 implements MigrationInterface {
  name = 'BackfillOpeningBalances1787200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * Tenants whose chart predates account 3100 have nowhere to post the
     * contra. `provisionChartOfAccounts` would add it on demand, but a
     * migration cannot call the service, so the row is created here on the
     * same terms — same code, name, type and role.
     */
    await queryRunner.query(`
      INSERT INTO "ledger_accounts" ("tenant_id", "code", "name", "type", "role", "is_system", "description")
      SELECT DISTINCT fa."tenantId",
             '3100',
             'Opening balance equity',
             'EQUITY'::"ledger_accounts_type_enum",
             'OPENING_BALANCE_EQUITY',
             true,
             'Contra for balances a tenant brought in from their previous system.'
      FROM "finance_accounts" fa
      WHERE NOT EXISTS (
        SELECT 1 FROM "ledger_accounts" la
        WHERE la."tenant_id" = fa."tenantId"
          AND la."role" = 'OPENING_BALANCE_EQUITY'
          AND la."deletedAt" IS NULL
      )
    `);

    /*
     * The gap, per account: what the row says it holds, less what the ledger
     * has actually posted to its cash account. `jsonb_array_elements` unnests
     * the lines, which live on the entry rather than in a table of their own.
     */
    const gaps: Array<{
      id: string;
      tenantId: string;
      name: string;
      createdAt: Date;
      ledgerAccountId: string;
      equityAccountId: string;
      cashCode: string;
      equityCode: string;
      gap: string;
    }> = await queryRunner.query(`
      SELECT fa."id",
             fa."tenantId",
             fa."name",
             fa."createdAt",
             fa."ledger_account_id" AS "ledgerAccountId",
             eq."id"                AS "equityAccountId",
             cash."code"            AS "cashCode",
             eq."code"              AS "equityCode",
             (fa."balance" - COALESCE(posted."net", 0))::text AS "gap"
      FROM "finance_accounts" fa
      JOIN "ledger_accounts" cash
        ON cash."id" = fa."ledger_account_id"
      JOIN "ledger_accounts" eq
        ON eq."tenant_id" = fa."tenantId"
       AND eq."role" = 'OPENING_BALANCE_EQUITY'
       AND eq."deletedAt" IS NULL
      LEFT JOIN LATERAL (
        SELECT SUM((line->>'debit')::numeric - (line->>'credit')::numeric) AS "net"
        FROM "journal_entries" je,
             LATERAL jsonb_array_elements(je."lines") AS line
        WHERE je."tenantId" = fa."tenantId"
          AND line->>'ledgerAccountId' = fa."ledger_account_id"::text
      ) posted ON TRUE
      WHERE fa."ledger_account_id" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "journal_entries" je
          WHERE je."tenantId" = fa."tenantId"
            AND je."referenceId" = 'opening-balance:' || fa."id"::text
        )
        AND ROUND(fa."balance" - COALESCE(posted."net", 0), 2) <> 0
    `);

    for (const gap of gaps) {
      const amount = Number(gap.gap);
      const debitsCash = amount > 0;
      const magnitude = Math.abs(Math.round(amount * 100) / 100);
      const description = `Opening balance for ${gap.name}`;

      const lines = [
        {
          ledgerAccountId: gap.ledgerAccountId,
          ledgerAccountCode: gap.cashCode,
          financeAccountId: gap.id,
          accountName: gap.name,
          debit: debitsCash ? magnitude : 0,
          credit: debitsCash ? 0 : magnitude,
          description,
        },
        {
          ledgerAccountId: gap.equityAccountId,
          ledgerAccountCode: gap.equityCode,
          financeAccountId: null,
          accountName: 'Opening balance equity',
          debit: debitsCash ? 0 : magnitude,
          credit: debitsCash ? magnitude : 0,
          description,
        },
      ];

      await queryRunner.query(
        `INSERT INTO "journal_entries"
           ("tenantId", "entryNumber", "referenceType", "referenceId", "entryDate", "lines", "totalAmount")
         VALUES ($1, $2, 'MANUAL', $3, $4, $5::jsonb, $6)`,
        [
          gap.tenantId,
          `JE-OB-${gap.id.slice(0, 8)}`,
          `opening-balance:${gap.id}`,
          gap.createdAt,
          JSON.stringify(lines),
          magnitude,
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only the entries this migration could have written: the service writes
    // its own with the same reference, and those belong to accounts created
    // after it, which this never touched.
    await queryRunner.query(`
      DELETE FROM "journal_entries"
      WHERE "referenceType" = 'MANUAL'
        AND "referenceId" LIKE 'opening-balance:%'
        AND "entryNumber" LIKE 'JE-OB-%'
    `);
  }
}
