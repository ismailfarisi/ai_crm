import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * VAT on expense claims.
 *
 * A claim can now name a purchase tax code, the VAT on its receipt and the
 * supplier's tax number. What was posted at approval (`recoverableTax`,
 * `reverseChargeTax`, `fxRate`, `taxPostedAt`) is kept on the claim so the tax
 * report reads the figure that reached the tax account.
 *
 * Every existing claim keeps a null code and zero VAT: it stays the claim it
 * was, and its posted journal entry is not touched.
 */
export class ExpenseClaimTax1792420000000 implements MigrationInterface {
  name = 'ExpenseClaimTax1792420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "expense_claims" ADD "taxCodeId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense_claims" ADD "taxAmount" numeric(14,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense_claims" ADD "supplierTaxId" character varying(32)`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense_claims" ADD "recoverableTax" numeric(14,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense_claims" ADD "reverseChargeTax" numeric(14,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense_claims" ADD "fxRate" numeric(18,8) NOT NULL DEFAULT '1'`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense_claims" ADD "taxPostedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "expense_claims" ADD "taxReversedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of [
      'taxReversedAt',
      'taxPostedAt',
      'fxRate',
      'reverseChargeTax',
      'recoverableTax',
      'supplierTaxId',
      'taxAmount',
      'taxCodeId',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "expense_claims" DROP COLUMN "${column}"`,
      );
    }
  }
}
