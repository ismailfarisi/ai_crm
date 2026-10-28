import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Action steps run with the permissions of the automation's owner: the user
 * who activated it, or who last saved graph changes to it while active.
 * Deleting that user leaves the automation in place with no owner.
 */
export class AutomationWorkflowOwner1790600000000
  implements MigrationInterface
{
  name = 'AutomationWorkflowOwner1790600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "automation_workflows" ADD COLUMN IF NOT EXISTS "activatedByUserId" uuid NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "automation_workflows" DROP CONSTRAINT IF EXISTS "fk_automation_workflows_activated_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "automation_workflows" ADD CONSTRAINT "fk_automation_workflows_activated_by" ` +
        `FOREIGN KEY ("activatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "automation_workflows" DROP CONSTRAINT IF EXISTS "fk_automation_workflows_activated_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "automation_workflows" DROP COLUMN IF EXISTS "activatedByUserId"`,
    );
  }
}
