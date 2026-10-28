import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-organisation switch for automations emailing AI-written text to
 * customers. Off by default; an admin turns it on in Settings -> AI.
 */
export class AiBudgetAutomationEmail1790600000001
  implements MigrationInterface
{
  name = 'AiBudgetAutomationEmail1790600000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_budgets" ADD COLUMN IF NOT EXISTS "automationAiEmailToCustomers" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_budgets" DROP COLUMN IF EXISTS "automationAiEmailToCustomers"`,
    );
  }
}
