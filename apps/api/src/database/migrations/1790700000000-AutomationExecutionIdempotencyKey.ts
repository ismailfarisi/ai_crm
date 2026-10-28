import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Webhook senders retry with an `Idempotency-Key`, and a schedule tick can be
 * delivered more than once. `idempotencyKey` records the key behind a run and
 * the partial unique index makes a repeat find that run (and resume it, if
 * Temporal refused the first start) instead of starting the automation again.
 * Runs without a key are unaffected.
 */
export class AutomationExecutionIdempotencyKey1790700000000 implements MigrationInterface {
  name = 'AutomationExecutionIdempotencyKey1790700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "automation_executions" ADD COLUMN IF NOT EXISTS "idempotencyKey" character varying(255)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_automation_executions_idempotency_key" ` +
        `ON "automation_executions" ("workflowId", "idempotencyKey") ` +
        `WHERE "idempotencyKey" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_automation_executions_idempotency_key"`,
    );
    await queryRunner.query(
      `ALTER TABLE "automation_executions" DROP COLUMN IF EXISTS "idempotencyKey"`,
    );
  }
}
