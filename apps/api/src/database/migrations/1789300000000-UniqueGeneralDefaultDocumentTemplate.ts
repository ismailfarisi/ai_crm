import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * At most one general default document template per tenant.
 *
 * A "general" default is one with no document types (`applies_to = '{}'`):
 * the fallback for any document without a type-specific default. Choosing a
 * new default cleared the old one and saved the new one as two separate
 * writes, so two concurrent changes could leave two general defaults, and
 * `create`/`update` never cleared the old one at all. Which template then
 * printed on a customer's invoice depended on row order.
 *
 * The service now makes default changes in one transaction under a
 * per-tenant advisory lock; this index is the backstop for the general slot.
 * Type-specific defaults live in an array column, which a unique index
 * cannot express, so those rely on the advisory lock alone.
 *
 * Existing duplicates are resolved first by keeping the most recently
 * updated general default per tenant, which is the one a user most likely
 * meant, and demoting the rest to ordinary templates. No template is
 * deleted.
 */
export class UniqueGeneralDefaultDocumentTemplate1789300000000
  implements MigrationInterface
{
  name = 'UniqueGeneralDefaultDocumentTemplate1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The table forces row-level security; the clean-up has to see every
    // tenant's rows. Transaction-local, so it ends with the migration.
    await queryRunner.query(`SELECT set_config('app.bypass_rls', 'on', true)`);

    await queryRunner.query(`
      UPDATE "document_templates" AS t
         SET "is_default" = false
       WHERE t."is_default"
         AND cardinality(t."applies_to") = 0
         AND t."id" <> (
           SELECT d."id"
             FROM "document_templates" AS d
            WHERE d."tenant_id" = t."tenant_id"
              AND d."is_default"
              AND cardinality(d."applies_to") = 0
            ORDER BY d."updated_at" DESC, d."id" DESC
            LIMIT 1
         )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_document_templates_general_default" ` +
        `ON "document_templates" ("tenant_id") ` +
        `WHERE "is_default" AND cardinality("applies_to") = 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The demoted duplicates are not restored: which ones they were is not
    // recorded, and more than one general default was never a valid state.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_document_templates_general_default"`,
    );
  }
}
