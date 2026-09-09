import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendInvoicesForLifecycle1786090000000
  implements MigrationInterface
{
  name = 'ExtendInvoicesForLifecycle1786090000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "invoices" ADD "customer_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "customer_name" character varying(255) NOT NULL DEFAULT 'General Customer'`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "customer_email" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "currency" character(3) NOT NULL DEFAULT 'USD'`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "items" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "subtotal_amount" numeric(12,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "discount_amount" numeric(12,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "tax_amount" numeric(12,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "payment_terms" character varying(50) NOT NULL DEFAULT 'immediate'`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "due_date" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "invoices" ADD "notes" text`);
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "paid_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "paid_amount" numeric(12,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "paid_via_account_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "sent_at" TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "FK_invoices_paid_via_account_id" FOREIGN KEY ("paid_via_account_id") REFERENCES "finance_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "FK_invoices_paid_via_account_id"`,
    );

    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "sent_at"`);
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN "paid_via_account_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN "paid_amount"`,
    );
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "paid_at"`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "notes"`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "due_date"`);
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN "payment_terms"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN "tax_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN "discount_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN "subtotal_amount"`,
    );
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "items"`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "currency"`);
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN "customer_email"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN "customer_name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN "customer_id"`,
    );
  }
}
