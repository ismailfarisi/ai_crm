import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Prompt-cache token counts on `ai_usage_logs`, so cache hits are visible and
 * costed: reads bill at a fraction of the input rate, writes above it.
 * Existing rows predate caching, so 0 is accurate for them.
 */
export class AiUsageCacheTokens1790300000000 implements MigrationInterface {
  name = 'AiUsageCacheTokens1790300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ai_usage_logs"
        ADD COLUMN "cacheReadInputTokens" integer NOT NULL DEFAULT 0,
        ADD COLUMN "cacheCreationInputTokens" integer NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ai_usage_logs"
        DROP COLUMN "cacheCreationInputTokens",
        DROP COLUMN "cacheReadInputTokens"
    `);
  }
}
