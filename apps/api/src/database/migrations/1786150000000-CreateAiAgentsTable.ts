import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAiAgentsTable1786150000000 implements MigrationInterface {
  name = 'CreateAiAgentsTable1786150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "public"."ai_agents_intent_enum" AS ENUM('GENERAL_QUESTION', 'QUOTATION_REQUEST', 'ORDER_STATUS', 'PRICING_QUESTION', 'COMPLAINT', 'SUPPORT_REQUEST', 'SCHEDULING', 'SPAM', 'OTHER');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "public"."ai_agents_action_type_enum" AS ENUM('AUTO_ACK', 'CREATE_DRAFT_QUOTE');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "ai_agents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "name" character varying(255) NOT NULL, "intent" "public"."ai_agents_intent_enum" NOT NULL, "actionType" "public"."ai_agents_action_type_enum" NOT NULL, "config" jsonb NOT NULL DEFAULT '{}', "confidenceThreshold" real NOT NULL DEFAULT 0.75, "eligibleProviders" jsonb NOT NULL DEFAULT '["EMAIL_SMTP","EMAIL_RESEND"]', "isEnabled" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_ai_agents_organizationId_intent" UNIQUE ("organizationId", "intent"), CONSTRAINT "PK_ai_agents_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_agents_organizationId" ON "ai_agents" ("organizationId")`,
    );

    // Seed sensible defaults for every existing organization so the feature
    // works out of the box without manual setup. Rows are editable/removable
    // via the AiAgent CRUD endpoints afterwards.
    await queryRunner.query(
      `INSERT INTO "ai_agents" ("organizationId", "name", "intent", "actionType", "config", "confidenceThreshold", "eligibleProviders", "isEnabled")
       SELECT "id", 'Order status auto-ack', 'ORDER_STATUS', 'AUTO_ACK',
         '{"template":"Thanks for reaching out. We are looking into your order status and will follow up shortly."}'::jsonb,
         0.75, '["EMAIL_SMTP","EMAIL_RESEND"]'::jsonb, true
       FROM "organizations"`,
    );
    await queryRunner.query(
      `INSERT INTO "ai_agents" ("organizationId", "name", "intent", "actionType", "config", "confidenceThreshold", "eligibleProviders", "isEnabled")
       SELECT "id", 'Scheduling auto-ack', 'SCHEDULING', 'AUTO_ACK',
         '{"template":"Thanks - we have received your scheduling request and will confirm a time shortly."}'::jsonb,
         0.75, '["EMAIL_SMTP","EMAIL_RESEND"]'::jsonb, true
       FROM "organizations"`,
    );
    await queryRunner.query(
      `INSERT INTO "ai_agents" ("organizationId", "name", "intent", "actionType", "config", "confidenceThreshold", "eligibleProviders", "isEnabled")
       SELECT "id", 'Quote drafting', 'QUOTATION_REQUEST', 'CREATE_DRAFT_QUOTE',
         '{"template":"Thanks for your interest. We are preparing a quote for you and someone will follow up shortly."}'::jsonb,
         0.75, '["EMAIL_SMTP","EMAIL_RESEND"]'::jsonb, true
       FROM "organizations"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ai_agents_organizationId"`,
    );
    await queryRunner.query(`DROP TABLE "ai_agents"`);
    await queryRunner.query(`DROP TYPE "public"."ai_agents_action_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."ai_agents_intent_enum"`);
  }
}
