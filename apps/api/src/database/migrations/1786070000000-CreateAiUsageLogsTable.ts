import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAiUsageLogsTable1786070000000 implements MigrationInterface {
  name = 'CreateAiUsageLogsTable1786070000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "ai_usage_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organizationId" uuid NOT NULL,
        "feature" character varying(100) NOT NULL,
        "provider" character varying(50) NOT NULL,
        "model" character varying(100) NOT NULL,
        "inputTokens" integer NOT NULL DEFAULT 0,
        "outputTokens" integer NOT NULL DEFAULT 0,
        "estimatedCostUsd" numeric(12,6) NOT NULL DEFAULT 0,
        "success" boolean NOT NULL DEFAULT true,
        "errorMessage" text,
        "actorUserId" uuid,
        "durationMs" integer,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_usage_logs_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_ai_usage_logs_organization_id" ON "ai_usage_logs" ("organizationId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_ai_usage_logs_feature" ON "ai_usage_logs" ("feature")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_ai_usage_logs_feature"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_ai_usage_logs_organization_id"`,
    );
    await queryRunner.query(`DROP TABLE "ai_usage_logs"`);
  }
}
