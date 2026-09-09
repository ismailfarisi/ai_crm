import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAiConfigsTable1786130000000 implements MigrationInterface {
  name = 'CreateAiConfigsTable1786130000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "public"."ai_configs_provider_enum" AS ENUM('OPENAI', 'ANTHROPIC', 'OPENROUTER');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "public"."ai_configs_status_enum" AS ENUM('unconfigured', 'configured', 'error');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "ai_configs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "provider" "public"."ai_configs_provider_enum" NOT NULL, "isEnabled" boolean NOT NULL DEFAULT false, "isDefault" boolean NOT NULL DEFAULT false, "encryptedCredentials" text, "status" "public"."ai_configs_status_enum" NOT NULL DEFAULT 'unconfigured', "lastTestedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_657541babf7bca1a40d9de72a2e" UNIQUE ("organizationId", "provider"), CONSTRAINT "PK_e062638208222edc23b70e8c31b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_389cc5a3c04e7be903ff212b89" ON "ai_configs" ("organizationId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_389cc5a3c04e7be903ff212b89"`);
    await queryRunner.query(`DROP TABLE "ai_configs"`);
    await queryRunner.query(`DROP TYPE "public"."ai_configs_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."ai_configs_provider_enum"`);
  }
}
