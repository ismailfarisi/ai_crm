import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAiBudgetsTable1786080000000 implements MigrationInterface {
  name = 'CreateAiBudgetsTable1786080000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "ai_budgets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organizationId" uuid NOT NULL,
        "monthlyBudgetUsd" numeric(12,2) NOT NULL,
        "alertThresholdPercent" numeric(5,2) NOT NULL DEFAULT 80,
        "isEnabled" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_budgets_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_budgets_organization_id" ON "ai_budgets" ("organizationId")`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        ALTER TABLE "ai_budgets" ADD CONSTRAINT "FK_ai_budgets_organization_id" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );

    // Composite index for the per-org monthly SUM query the budget guard runs
    // on every AI call (organizationId alone is already indexed from the
    // original ai_usage_logs migration; this adds the date-range component).
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_ai_usage_logs_org_created_at" ON "ai_usage_logs" ("organizationId", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_ai_usage_logs_org_created_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_budgets" DROP CONSTRAINT IF EXISTS "FK_ai_budgets_organization_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_ai_budgets_organization_id"`,
    );
    await queryRunner.query(`DROP TABLE "ai_budgets"`);
  }
}
