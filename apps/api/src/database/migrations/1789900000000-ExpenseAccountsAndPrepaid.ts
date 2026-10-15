import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Overhead accounts under 6000, and 1400 Prepaid expenses, for every existing
 * tenant. New tenants get them from provisionChartOfAccounts.
 *
 * A tenant that already uses a code or a role is skipped for that account;
 * postings for that role fall back to 6000 (LedgerService). History stays in
 * 6000 — the ledger is append-only.
 */
const ACCOUNTS: Array<
  [
    code: string,
    name: string,
    type: 'ASSET' | 'EXPENSE',
    role: string,
    parent: string | null,
    description: string,
  ]
> = [
  ['1400', 'Prepaid expenses', 'ASSET', 'PREPAID_EXPENSES', null, 'Paid or billed ahead for a period not yet used — an annual lease, a yearly policy. Released to expense one month at a time.'],
  ['6100', 'Rent & premises', 'EXPENSE', 'RENT', '6000', 'Rent, service charges and premises costs'],
  ['6200', 'Utilities & telecom', 'EXPENSE', 'UTILITIES', '6000', 'Electricity, water, cooling, internet and phones'],
  ['6300', 'Salaries & wages', 'EXPENSE', 'SALARIES', '6000', 'Payroll, allowances and contractors'],
  ['6400', 'Repairs & maintenance', 'EXPENSE', 'REPAIRS', '6000', 'Upkeep of premises, plant and machinery'],
  ['6450', 'Insurance', 'EXPENSE', 'INSURANCE', '6000', 'Insurance premiums'],
  ['6500', 'Travel & entertainment', 'EXPENSE', 'TRAVEL', '6000', 'Travel, lodging, meals and entertainment'],
  ['6600', 'Software & IT', 'EXPENSE', 'SOFTWARE_IT', '6000', 'Software subscriptions, hosting and IT equipment below the capitalisation threshold'],
  ['6700', 'Marketing', 'EXPENSE', 'MARKETING', '6000', 'Advertising and marketing'],
  ['6800', 'Professional fees', 'EXPENSE', 'PROFESSIONAL_FEES', '6000', 'Accounting, legal and consulting fees'],
  ['6900', 'Bank charges', 'EXPENSE', 'BANK_CHARGES', '6000', 'Bank and payment processing fees'],
];

export class ExpenseAccountsAndPrepaid1789900000000 implements MigrationInterface {
  name = 'ExpenseAccountsAndPrepaid1789900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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

    await queryRunner.query(
      `UPDATE "ledger_accounts"
          SET "name" = 'Other operating expense',
              "description" = 'Overheads with no account of their own. Parent of the overhead accounts below.'
        WHERE "role" = 'OPERATING_EXPENSE' AND "is_system" AND "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SELECT set_config('app.bypass_rls','on',true)`);
    await queryRunner.query(
      `UPDATE "ledger_accounts" SET "deletedAt" = now()
        WHERE "is_system" AND "role" = ANY($1) AND "deletedAt" IS NULL`,
      [ACCOUNTS.map((a) => a[3])],
    );
    await queryRunner.query(
      `UPDATE "ledger_accounts" SET "name" = 'Operating expense', "description" = 'Overheads and employee expense claims'
        WHERE "role" = 'OPERATING_EXPENSE' AND "is_system" AND "deletedAt" IS NULL`,
    );
  }
}
