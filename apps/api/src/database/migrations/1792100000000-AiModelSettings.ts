import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves the choice of model off the provider. `ai_settings` holds the
 * organization's default model and per-feature choices; the intent agent
 * gains a provider next to its model. A provider's stored model stays readable as
 * the fallback, so an organization that changes nothing behaves as before.
 */
export class AiModelSettings1792100000000 implements MigrationInterface {
  name = 'AiModelSettings1792100000000';

  private static readonly AGENT_TABLES = ['intent_agent_configs'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "ai_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "defaultModel" character varying(120), "featureModels" jsonb NOT NULL DEFAULT '{}', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ai_settings" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_settings_organization_id" ON "ai_settings" ("organizationId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_settings" ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(`ALTER TABLE "ai_settings" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(
      `DROP POLICY IF EXISTS tenant_isolation_policy ON "ai_settings"`,
    );
    await queryRunner.query(
      `CREATE POLICY tenant_isolation_policy ON "ai_settings" FOR ALL ` +
        `USING (current_setting('app.bypass_rls', true) = 'on' OR "organizationId" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
        `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "organizationId" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`,
    );
    for (const table of AiModelSettings1792100000000.AGENT_TABLES) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "provider" character varying(20)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of AiModelSettings1792100000000.AGENT_TABLES) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "provider"`,
      );
    }
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_settings"`);
  }
}
