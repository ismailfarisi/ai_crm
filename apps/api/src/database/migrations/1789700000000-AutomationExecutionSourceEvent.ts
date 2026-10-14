import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CRM events reach automations through the outbox, which delivers at least
 * once. `sourceEventId` records the outbox event behind each run and the
 * partial unique index makes a redelivery find that run instead of starting
 * the automation a second time. Runs started by hand or by webhook have no
 * source event and are unaffected.
 */
export class AutomationExecutionSourceEvent1789700000000
  implements MigrationInterface
{
  name = 'AutomationExecutionSourceEvent1789700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "automation_executions" ADD COLUMN IF NOT EXISTS "sourceEventId" uuid`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_automation_executions_source_event" ` +
        `ON "automation_executions" ("workflowId", "sourceEventId") ` +
        `WHERE "sourceEventId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_automation_executions_source_event"`,
    );
    await queryRunner.query(
      `ALTER TABLE "automation_executions" DROP COLUMN IF EXISTS "sourceEventId"`,
    );
  }
}
