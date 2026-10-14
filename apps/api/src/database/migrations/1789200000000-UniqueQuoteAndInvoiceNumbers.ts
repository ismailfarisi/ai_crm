import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes quote and invoice numbers unique per tenant.
 *
 * Both were only ever unique by convention: invoice numbers come from the
 * tenant sequence, but quote numbers were also accepted from the client, so
 * two quotes could carry the same number. Revisions do not collide — each
 * gets its own `-R<n>` suffix (`reviseQuote`) — and NULL quote numbers stay
 * allowed, since Postgres treats NULLs as distinct in a unique index.
 *
 * Existing duplicates are not renumbered here. A document number may already
 * be printed on a PDF in a customer's inbox, so which copy keeps it is a
 * business decision. The migration refuses instead, naming every clash, and
 * leaves the schema untouched until they are resolved.
 */
export class UniqueQuoteAndInvoiceNumbers1789200000000
  implements MigrationInterface
{
  name = 'UniqueQuoteAndInvoiceNumbers1789200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The duplicate check must see every tenant's rows even if the migration
    // role is subject to the tenant RLS policies (local to this transaction).
    await queryRunner.query(`SELECT set_config('app.bypass_rls', 'on', true)`);

    const problems = [
      ...(await this.duplicates(queryRunner, 'quotes', 'quote_number')),
      ...(await this.duplicates(queryRunner, 'invoices', 'invoice_number')),
    ];
    if (problems.length) {
      throw new Error(
        `Cannot add unique quote/invoice numbers: ${problems.length} duplicate number(s) found. ` +
          `Renumber all but one row of each before running this migration again:\n` +
          problems.join('\n'),
      );
    }

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_quotes_tenant_number"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_quotes_tenant_number" ON "quotes" ("tenant_id", "quote_number")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_invoices_tenant_number" ON "invoices" ("tenant_id", "invoice_number")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_invoices_tenant_number"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_quotes_tenant_number"`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_quotes_tenant_number" ON "quotes" ("tenant_id", "quote_number")`,
    );
  }

  private async duplicates(
    queryRunner: QueryRunner,
    table: 'quotes' | 'invoices',
    column: 'quote_number' | 'invoice_number',
  ): Promise<string[]> {
    const rows: Array<{
      tenant_id: string;
      number: string;
      copies: number;
      ids: string[];
    }> = await queryRunner.query(
      `SELECT "tenant_id", "${column}" AS "number", COUNT(*)::int AS "copies",
              array_agg("id"::text ORDER BY "id") AS "ids"
         FROM "${table}"
        WHERE "${column}" IS NOT NULL
        GROUP BY "tenant_id", "${column}"
       HAVING COUNT(*) > 1
        ORDER BY "tenant_id", "${column}"`,
    );
    return rows.map(
      (r) =>
        `  ${table}: tenant ${r.tenant_id} has ${r.copies} rows numbered "${r.number}" (ids: ${r.ids.join(', ')})`,
    );
  }
}
