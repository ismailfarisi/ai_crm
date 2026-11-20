import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Conversation handover: `channel_threads` records whether the AI or a person
 * is answering each customer conversation, a HUMAN_REQUEST intent lets the
 * classifier say "they asked for a person", and the intent agent gains the
 * message a customer is sent when the AI steps back.
 */
export class ChannelThreads1792200000000 implements MigrationInterface {
  name = 'ChannelThreads1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const enumType of [
      'channel_messages_ai_intent_enum',
      'ai_agents_intent_enum',
    ]) {
      await queryRunner.query(
        `ALTER TYPE "public"."${enumType}" ADD VALUE IF NOT EXISTS 'HUMAN_REQUEST'`,
      );
    }
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "channel_threads" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "provider" character varying(30) NOT NULL, "contactId" uuid NOT NULL, "state" character varying(20) NOT NULL DEFAULT 'AI', "assigneeUserId" uuid, "handoverReason" character varying(40), "handoverSummary" text, "handedOverAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_channel_threads" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_channel_threads_unique" ON "channel_threads" ("organizationId", "provider", "contactId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_threads" ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_threads" FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS tenant_isolation_policy ON "channel_threads"`,
    );
    await queryRunner.query(
      `CREATE POLICY tenant_isolation_policy ON "channel_threads" FOR ALL ` +
        `USING (current_setting('app.bypass_rls', true) = 'on' OR "organizationId" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
        `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "organizationId" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`,
    );
    await queryRunner.query(
      `ALTER TABLE "intent_agent_configs" ADD COLUMN IF NOT EXISTS "handoverMessage" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "intent_agent_configs" DROP COLUMN IF EXISTS "handoverMessage"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "channel_threads"`);
    // Postgres cannot drop a single enum value; HUMAN_REQUEST is inert when unused.
  }
}
