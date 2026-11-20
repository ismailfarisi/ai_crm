import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agents an organization defines for itself (`channel_agents`), and which
 * agent last held a conversation (`channel_threads.agentId`).
 */
export class ChannelAgents1792300000000 implements MigrationInterface {
  name = 'ChannelAgents1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "channel_agents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "name" character varying(80) NOT NULL, "description" character varying(300) NOT NULL, "instructions" text NOT NULL, "kind" character varying(20) NOT NULL, "provider" character varying(20), "model" character varying(120), "skills" jsonb NOT NULL DEFAULT '[]', "channels" jsonb NOT NULL DEFAULT '[]', "isEnabled" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_channel_agents" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_channel_agents_name" ON "channel_agents" ("organizationId", "name")`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_agents" ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_agents" FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS tenant_isolation_policy ON "channel_agents"`,
    );
    await queryRunner.query(
      `CREATE POLICY tenant_isolation_policy ON "channel_agents" FOR ALL ` +
        `USING (current_setting('app.bypass_rls', true) = 'on' OR "organizationId" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
        `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "organizationId" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_threads" ADD COLUMN IF NOT EXISTS "agentId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "channel_threads" DROP COLUMN IF EXISTS "agentId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "channel_agents"`);
  }
}
