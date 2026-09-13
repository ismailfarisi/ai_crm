import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The chart of accounts, and the backfill that gives every existing journal
 * line an account to belong to.
 *
 * Before this, `journal_entries.lines` held account *names* as free text:
 * `'Accounts Receivable'`, `'Bank Account'`, or whatever an expense's
 * category happened to be called. Nothing could be reported off it.
 *
 * S1 band (1786300000000–1786390000000), so it sorts before the purchasing
 * migration regardless of the order the two branches merge in.
 *
 * The backfill is the risky half. It is data-only and idempotent: every
 * statement is guarded so re-running changes nothing, and lines that already
 * carry a `ledgerAccountId` are left alone. Rehearse it against a restored
 * snapshot before it goes near production.
 */
export class CreateLedgerAccounts1786300000000 implements MigrationInterface {
  name = 'CreateLedgerAccounts1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "ledger_accounts_type_enum" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE')`,
    );

    await queryRunner.query(`
      CREATE TABLE "ledger_accounts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "tenant_id" uuid NOT NULL,
        "code" character varying(20) NOT NULL,
        "name" character varying(120) NOT NULL,
        "type" "ledger_accounts_type_enum" NOT NULL,
        "role" character varying(40),
        "parent_id" uuid,
        "is_system" boolean NOT NULL DEFAULT false,
        "is_active" boolean NOT NULL DEFAULT true,
        "description" text,
        CONSTRAINT "PK_ledger_accounts" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_ledger_accounts_tenant" ON "ledger_accounts" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_ledger_accounts_tenant_code" ON "ledger_accounts" ("tenant_id", "code") WHERE "deletedAt" IS NULL`,
    );
    // Two accounts both claiming a role would make resolution
    // non-deterministic, and that failure looks like money in the wrong
    // place rather than an error.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_ledger_accounts_tenant_role" ON "ledger_accounts" ("tenant_id", "role") WHERE "role" IS NOT NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_accounts" ADD CONSTRAINT "FK_ledger_accounts_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_accounts" ADD CONSTRAINT "FK_ledger_accounts_parent" FOREIGN KEY ("parent_id") REFERENCES "ledger_accounts"("id") ON DELETE SET NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "finance_accounts" ADD COLUMN IF NOT EXISTS "ledger_account_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "finance_accounts" ADD CONSTRAINT "FK_finance_accounts_ledger" FOREIGN KEY ("ledger_account_id") REFERENCES "ledger_accounts"("id") ON DELETE SET NULL`,
    );

    /* ---- seed the system chart for every existing tenant ---- */
    const SYSTEM_ACCOUNTS: [string, string, string, string, string][] = [
      [
        '1000',
        'Cash and bank',
        'ASSET',
        'CASH',
        'Parent of the individual bank, cash and card accounts',
      ],
      [
        '1100',
        'Accounts receivable',
        'ASSET',
        'ACCOUNTS_RECEIVABLE',
        'Invoiced to customers and not yet paid',
      ],
      [
        '1200',
        'Inventory',
        'ASSET',
        'INVENTORY',
        'Raw stock on hand, at moving-average cost',
      ],
      [
        '1250',
        'Goods received not invoiced',
        'LIABILITY',
        'GRNI',
        'Received from a supplier, awaiting their bill',
      ],
      [
        '1300',
        'Work in progress',
        'ASSET',
        'WIP',
        'Materials and labour issued to jobs not yet complete',
      ],
      [
        '2100',
        'Accounts payable',
        'LIABILITY',
        'ACCOUNTS_PAYABLE',
        'Owed to suppliers and employees',
      ],
      [
        '2200',
        'Tax payable',
        'LIABILITY',
        'TAX_PAYABLE',
        'Sales tax collected and not yet remitted',
      ],
      [
        '3000',
        'Retained earnings',
        'EQUITY',
        'RETAINED_EARNINGS',
        'Accumulated result of prior periods',
      ],
      ['4000', 'Sales', 'INCOME', 'SALES', 'Revenue from invoiced work'],
      [
        '5000',
        'Cost of goods sold',
        'EXPENSE',
        'COGS',
        'Materials and labour consumed by completed work',
      ],
      [
        '6000',
        'Operating expense',
        'EXPENSE',
        'OPERATING_EXPENSE',
        'Overheads and employee expense claims',
      ],
    ];

    for (const [code, name, type, role, description] of SYSTEM_ACCOUNTS) {
      await queryRunner.query(
        // Every parameter is cast explicitly. `$1` appears both in the SELECT
        // list, where Postgres infers it from the target column
        // (character varying), and in the NOT EXISTS comparison, where it
        // infers text — which fails as 42P08, "inconsistent types deduced for
        // parameter". The casts settle it in one place rather than leaving it
        // to inference.
        `INSERT INTO "ledger_accounts" ("tenant_id", "code", "name", "type", "role", "is_system", "description")
         SELECT o."id", $1::varchar, $2::varchar, $3::"ledger_accounts_type_enum", $4::varchar, true, $5::text
         FROM "organizations" o
         WHERE NOT EXISTS (
           SELECT 1 FROM "ledger_accounts" la
           WHERE la."tenant_id" = o."id" AND la."code" = $1::varchar
         )`,
        [code, name, type, role, description],
      );
    }

    // Parent every system cash account under 1000.
    await queryRunner.query(`
      UPDATE "ledger_accounts" child
      SET "parent_id" = parent."id"
      FROM "ledger_accounts" parent
      WHERE parent."tenant_id" = child."tenant_id"
        AND parent."code" = '1000'
        AND child."code" <> '1000'
        AND child."code" LIKE '10%'
        AND child."parent_id" IS NULL
    `);

    /* ---- one ledger account per existing cash account ---- */
    // Numbered 1001, 1002, ... within each tenant so a trial balance shows a
    // figure per bank that can be reconciled against a statement.
    await queryRunner.query(`
      WITH numbered AS (
        SELECT fa."id" AS finance_account_id,
               fa."tenantId" AS tenant_id,
               fa."name" AS name,
               1000 + ROW_NUMBER() OVER (PARTITION BY fa."tenantId" ORDER BY fa."createdAt", fa."id") AS code_num
        FROM "finance_accounts" fa
        WHERE fa."ledger_account_id" IS NULL
      ),
      inserted AS (
        INSERT INTO "ledger_accounts"
          ("tenant_id", "code", "name", "type", "role", "parent_id", "is_system", "description")
        SELECT n.tenant_id,
               n.code_num::text,
               n.name,
               'ASSET'::"ledger_accounts_type_enum",
               NULL,
               (SELECT la."id" FROM "ledger_accounts" la
                 WHERE la."tenant_id" = n.tenant_id AND la."code" = '1000'),
               true,
               'Cash account: ' || n.name
        FROM numbered n
        RETURNING "id", "tenant_id", "code"
      )
      UPDATE "finance_accounts" fa
      SET "ledger_account_id" = i."id"
      FROM inserted i, numbered n
      WHERE n.finance_account_id = fa."id"
        AND i."tenant_id" = n.tenant_id
        AND i."code" = n.code_num::text
    `);

    /* ---- rewrite every stored journal line ---- */
    // Each line gains `ledgerAccountId` and `ledgerAccountCode`, and the old
    // optional `accountId` becomes `financeAccountId`. Resolution order:
    //   1. the line already names a cash account -> that account's ledger row
    //   2. the literal names the pre-ledger code wrote
    //   3. anything else (expense categories) -> operating expense
    await queryRunner.query(`
      UPDATE "journal_entries" je
      SET "lines" = sub.new_lines
      FROM (
        SELECT e."id" AS entry_id,
               jsonb_agg(
                 (line - 'accountId')
                 || jsonb_build_object(
                      'financeAccountId', line->'accountId',
                      'ledgerAccountId', to_jsonb(resolved."id"::text),
                      'ledgerAccountCode', to_jsonb(resolved."code")
                    )
                 ORDER BY idx
               ) AS new_lines
        FROM "journal_entries" e
        CROSS JOIN LATERAL jsonb_array_elements(e."lines") WITH ORDINALITY AS t(line, idx)
        LEFT JOIN LATERAL (
          SELECT la."id", la."code"
          FROM "ledger_accounts" la
          WHERE la."tenant_id" = e."tenantId"
            AND la."id" = (
              CASE
                WHEN line->>'accountId' IS NOT NULL THEN
                  (SELECT fa."ledger_account_id" FROM "finance_accounts" fa
                    WHERE fa."id" = (line->>'accountId')::uuid)
                ELSE (
                  SELECT l2."id" FROM "ledger_accounts" l2
                  WHERE l2."tenant_id" = e."tenantId"
                    AND l2."role" = CASE lower(coalesce(line->>'accountName', ''))
                      WHEN 'accounts receivable' THEN 'ACCOUNTS_RECEIVABLE'
                      WHEN 'accounts payable'    THEN 'ACCOUNTS_PAYABLE'
                      WHEN 'bank account'        THEN 'CASH'
                      ELSE 'OPERATING_EXPENSE'
                    END
                )
              END
            )
          LIMIT 1
        ) resolved ON TRUE
        WHERE e."lines" IS NOT NULL
          AND jsonb_typeof(e."lines") = 'array'
          AND jsonb_array_length(e."lines") > 0
          AND NOT (e."lines" -> 0 ? 'ledgerAccountId')
        GROUP BY e."id"
      ) sub
      WHERE je."id" = sub.entry_id
    `);

    // Nothing should have slipped through; a null here would mean a line
    // whose tenant has no chart at all, which the seed above rules out.
    const orphans: { count: string }[] = await queryRunner.query(`
      SELECT count(*)::text AS count
      FROM "journal_entries" e
      CROSS JOIN LATERAL jsonb_array_elements(e."lines") AS line
      WHERE line->>'ledgerAccountId' IS NULL
    `);
    if (orphans[0] && Number(orphans[0].count) > 0) {
      throw new Error(
        `Ledger backfill left ${orphans[0].count} journal line(s) without a ledger account; aborting so the transaction rolls back`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Put the lines back the way they were. `accountName` was never removed,
    // so the old shape is recoverable in full.
    await queryRunner.query(`
      UPDATE "journal_entries" je
      SET "lines" = sub.old_lines
      FROM (
        SELECT e."id" AS entry_id,
               jsonb_agg(
                 (line - 'ledgerAccountId' - 'ledgerAccountCode' - 'financeAccountId')
                 || CASE WHEN line->'financeAccountId' IS NOT NULL
                           AND line->>'financeAccountId' <> ''
                         THEN jsonb_build_object('accountId', line->'financeAccountId')
                         ELSE '{}'::jsonb END
                 ORDER BY idx
               ) AS old_lines
        FROM "journal_entries" e
        CROSS JOIN LATERAL jsonb_array_elements(e."lines") WITH ORDINALITY AS t(line, idx)
        WHERE e."lines" IS NOT NULL AND jsonb_typeof(e."lines") = 'array'
        GROUP BY e."id"
      ) sub
      WHERE je."id" = sub.entry_id
    `);

    await queryRunner.query(
      `ALTER TABLE "finance_accounts" DROP CONSTRAINT IF EXISTS "FK_finance_accounts_ledger"`,
    );
    await queryRunner.query(
      `ALTER TABLE "finance_accounts" DROP COLUMN IF EXISTS "ledger_account_id"`,
    );
    await queryRunner.query(`DROP TABLE "ledger_accounts"`);
    await queryRunner.query(`DROP TYPE "ledger_accounts_type_enum"`);
  }
}
