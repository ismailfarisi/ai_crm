import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backs the atomic per-tenant numbering used by quotes, expense claims, and
 * invoices (see tenant-sequence.util.ts). Not modeled as a TypeORM entity —
 * it's accessed only via raw upserts, so it stays invisible to
 * `migration:generate`'s diff.
 */
export class CreateTenantSequences1786100000000 implements MigrationInterface {
  name = 'CreateTenantSequences1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "tenant_sequences" ("tenant_id" uuid NOT NULL, "sequence_name" character varying(50) NOT NULL, "current_value" integer NOT NULL DEFAULT 0, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_tenant_sequences" PRIMARY KEY ("tenant_id", "sequence_name"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_sequences" ADD CONSTRAINT "FK_tenant_sequences_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // Backfill so post-migration numbers continue seamlessly from each
    // tenant's current count — no collisions against already-issued numbers.
    // Note the column-name split: quotes/invoices use snake_case "tenant_id",
    // expense_claims uses camelCase "tenantId" (no explicit column name was
    // set on that entity), so each backfill references its table's real casing.
    await queryRunner.query(
      `INSERT INTO "tenant_sequences" ("tenant_id", "sequence_name", "current_value")
       SELECT "tenant_id", 'quote_number', COUNT(*)::int FROM "quotes" GROUP BY "tenant_id"`,
    );
    await queryRunner.query(
      `INSERT INTO "tenant_sequences" ("tenant_id", "sequence_name", "current_value")
       SELECT "tenant_id", 'invoice_number', COUNT(*)::int FROM "invoices" GROUP BY "tenant_id"`,
    );
    await queryRunner.query(
      `INSERT INTO "tenant_sequences" ("tenant_id", "sequence_name", "current_value")
       SELECT "tenantId", 'claim_number', COUNT(*)::int FROM "expense_claims" GROUP BY "tenantId"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenant_sequences" DROP CONSTRAINT "FK_tenant_sequences_tenant_id"`,
    );
    await queryRunner.query(`DROP TABLE "tenant_sequences"`);
  }
}
