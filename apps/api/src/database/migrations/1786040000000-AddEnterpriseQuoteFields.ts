import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEnterpriseQuoteFields1786040000000 implements MigrationInterface {
  name = 'AddEnterpriseQuoteFields1786040000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "quotes" ADD "quote_number" character varying(60)`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" ADD "customer_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" ADD "customer_name" character varying(255) NOT NULL DEFAULT 'General Customer'`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" ADD "customer_email" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" ADD "valid_until" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" ADD "payment_terms" character varying(50) NOT NULL DEFAULT 'immediate'`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" ADD "currency" character(3) NOT NULL DEFAULT 'USD'`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" ADD "subtotal_amount" numeric(12,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" ADD "discount_amount" numeric(12,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" ADD "tax_amount" numeric(12,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" ADD "terms_and_conditions" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" ADD "notes" text`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_quotes_tenant_number" ON "quotes" ("tenant_id", "quote_number")`,
    );

    // Backfill quote_number and subtotal_amount for existing rows
    await queryRunner.query(
      `UPDATE "quotes" SET "quote_number" = 'Q-' || UPPER(SUBSTR("id"::text, 1, 8)) WHERE "quote_number" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "quotes" SET "subtotal_amount" = "totalAmount" WHERE "subtotal_amount" = 0 AND "totalAmount" > 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_quotes_tenant_number"`,
    );

    await queryRunner.query(
      `ALTER TABLE "quotes" DROP COLUMN "notes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" DROP COLUMN "terms_and_conditions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" DROP COLUMN "tax_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" DROP COLUMN "discount_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" DROP COLUMN "subtotal_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" DROP COLUMN "currency"`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" DROP COLUMN "payment_terms"`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" DROP COLUMN "valid_until"`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" DROP COLUMN "customer_email"`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" DROP COLUMN "customer_name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" DROP COLUMN "customer_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" DROP COLUMN "quote_number"`,
    );
  }
}
