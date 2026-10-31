import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What the claimant wrote about an expense claim: the business purpose, who
 * was there.
 *
 * The submit form always asked for it and then dropped it, so the claim's
 * detail page made a sentence up from the category instead. Claims filed
 * before this have no notes (null) and say so.
 */
export class ExpenseClaimNotes1791000000600 implements MigrationInterface {
  name = 'ExpenseClaimNotes1791000000600';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "expense_claims" ADD COLUMN "notes" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "expense_claims" DROP COLUMN "notes"`);
  }
}
