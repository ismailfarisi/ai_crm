import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Separate from AutomationRunHistory because a new enum value cannot be used
 * in the transaction that adds it.
 *
 * Runs that look unfinished but recorded no steps predate step history, so
 * nothing can say how they ended. Mark them UNKNOWN rather than leave them
 * "running" forever.
 */
export class AutomationRunHistoryCloseOut1790800000001 implements MigrationInterface {
  name = 'AutomationRunHistoryCloseOut1790800000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `migration:run` wraps all pending migrations in one transaction, and
    // Postgres refuses a new enum value inside the transaction that added it.
    // Commit what has run so far (including the ADD VALUE) and carry on in a
    // fresh transaction; TypeORM commits that one as usual.
    if (queryRunner.isTransactionActive) {
      await queryRunner.commitTransaction();
      await queryRunner.startTransaction();
    }
    await queryRunner.query(
      `UPDATE "automation_executions" SET "status" = 'UNKNOWN' ` +
        `WHERE "status" IN ('RUNNING', 'WAITING_APPROVAL') AND "nodeResults" = '{}'::jsonb`,
    );
  }

  public async down(): Promise<void> {
    // No-op: the previous statuses are not recoverable, and UNKNOWN is harmless.
  }
}
