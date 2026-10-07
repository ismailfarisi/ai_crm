import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSavedViewsTable1788000000000 implements MigrationInterface {
  name = 'CreateSavedViewsTable1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "saved_views" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "entityType" character varying(40) NOT NULL,
        "name" character varying(80) NOT NULL,
        "viewType" character varying(20) NOT NULL DEFAULT 'table',
        "isDefault" boolean NOT NULL DEFAULT false,
        "isShared" boolean NOT NULL DEFAULT false,
        "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_saved_views_id" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "idx_saved_views_tenant_entity" ON "saved_views" ("tenant_id", "entityType", "isShared");
      CREATE INDEX IF NOT EXISTS "idx_saved_views_user" ON "saved_views" ("tenant_id", "userId");
    `);
    await queryRunner.query(`ALTER TABLE "saved_views" ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE "saved_views" FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(
      `CREATE POLICY tenant_isolation_policy ON "saved_views" FOR ALL ` +
        `USING (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
        `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "saved_views"`);
  }
}
