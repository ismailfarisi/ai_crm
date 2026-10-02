import { MigrationInterface, QueryRunner } from 'typeorm';

export class StandardizeTenantIdColumns1787500000000 implements MigrationInterface {
  name = 'StandardizeTenantIdColumns1787500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. contacts
    await queryRunner.query(
      `ALTER TABLE "contacts" RENAME COLUMN "organizationId" TO "tenant_id"`,
    );

    // 2. customers
    await queryRunner.query(
      `ALTER TABLE "customers" RENAME COLUMN "organizationId" TO "tenant_id"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "uq_customers_org_company" RENAME TO "uq_customers_tenant_company"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "idx_customers_org_created" RENAME TO "idx_customers_tenant_created"`,
    );

    // 3. teams
    await queryRunner.query(
      `ALTER TABLE "teams" RENAME COLUMN "organizationId" TO "tenant_id"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_teams_org_name"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_teams_tenant_name" ON "teams" ("tenant_id", "name")`,
    );

    // 4. users
    await queryRunner.query(
      `ALTER TABLE "users" RENAME COLUMN "organizationId" TO "tenant_id"`,
    );

    // 5. roles
    await queryRunner.query(
      `ALTER TABLE "roles" RENAME COLUMN "organizationId" TO "tenant_id"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "uq_roles_org_slug" RENAME TO "uq_roles_tenant_slug"`,
    );

    // 6. invitations
    await queryRunner.query(
      `ALTER TABLE "invitations" RENAME COLUMN "organizationId" TO "tenant_id"`,
    );

    // 7. document_templates
    await queryRunner.query(
      `ALTER TABLE "document_templates" RENAME COLUMN "organization_id" TO "tenant_id"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "idx_document_templates_org" RENAME TO "idx_document_templates_tenant"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "idx_document_templates_tenant" RENAME TO "idx_document_templates_org"`,
    );
    await queryRunner.query(
      `ALTER TABLE "document_templates" RENAME COLUMN "tenant_id" TO "organization_id"`,
    );

    await queryRunner.query(
      `ALTER TABLE "invitations" RENAME COLUMN "tenant_id" TO "organizationId"`,
    );

    await queryRunner.query(
      `ALTER INDEX IF EXISTS "uq_roles_tenant_slug" RENAME TO "uq_roles_org_slug"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roles" RENAME COLUMN "tenant_id" TO "organizationId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" RENAME COLUMN "tenant_id" TO "organizationId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "teams" RENAME COLUMN "tenant_id" TO "organizationId"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_teams_org_name" ON "teams" ("organizationId")`,
    );

    await queryRunner.query(
      `ALTER INDEX IF EXISTS "idx_customers_tenant_created" RENAME TO "idx_customers_org_created"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "uq_customers_tenant_company" RENAME TO "uq_customers_org_company"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers" RENAME COLUMN "tenant_id" TO "organizationId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "contacts" RENAME COLUMN "tenant_id" TO "organizationId"`,
    );
  }
}
