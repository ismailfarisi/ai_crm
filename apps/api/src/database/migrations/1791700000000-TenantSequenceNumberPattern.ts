import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Optional per-tenant, per-sequence document-number pattern. NULL keeps the
 * default `PREFIX-YYYY-NNNN` format from formatSequenceNumber, so nothing
 * changes for tenants that never set one. See renderNumberPattern and
 * formatTenantSequenceNumber in tenant-sequence.util.ts for the `{Y}` /
 * `{N}` / `{N:k}` token syntax.
 */
export class TenantSequenceNumberPattern1791700000000
  implements MigrationInterface
{
  name = 'TenantSequenceNumberPattern1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenant_sequences" ADD COLUMN "number_pattern" character varying(60)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenant_sequences" DROP COLUMN "number_pattern"`,
    );
  }
}
