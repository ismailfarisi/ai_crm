import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIntentAgentConfigsTable1786170000000 implements MigrationInterface {
  name = 'CreateIntentAgentConfigsTable1786170000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "intent_agent_configs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "maxTurns" integer NOT NULL DEFAULT 5, "replyTimeoutMinutes" integer NOT NULL DEFAULT 15, "systemPrompt" text, "eligibleProviders" jsonb NOT NULL DEFAULT '["TELEGRAM","WHATSAPP_META"]', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_intent_agent_configs_organizationId" UNIQUE ("organizationId"), CONSTRAINT "PK_intent_agent_configs_id" PRIMARY KEY ("id"))`,
    );

    // Seed a default row for every existing organization so behavior is
    // unchanged and immediately visible/editable in the UI.
    await queryRunner.query(
      `INSERT INTO "intent_agent_configs" ("organizationId", "isEnabled", "maxTurns", "replyTimeoutMinutes", "systemPrompt", "eligibleProviders")
       SELECT "id", true, 5, 15, NULL, '["TELEGRAM","WHATSAPP_META"]'::jsonb
       FROM "organizations"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "intent_agent_configs"`);
  }
}
