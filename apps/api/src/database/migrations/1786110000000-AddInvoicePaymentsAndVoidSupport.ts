import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoicePaymentsAndVoidSupport1786110000000 implements MigrationInterface {
  name = 'AddInvoicePaymentsAndVoidSupport1786110000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "invoices_status_enum" ADD VALUE IF NOT EXISTS 'PARTIALLY_PAID'`,
    );
    await queryRunner.query(
      `ALTER TYPE "invoices_status_enum" ADD VALUE IF NOT EXISTS 'CANCELLED'`,
    );

    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "voided_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "invoices" ADD "voided_by_id" uuid`);
    await queryRunner.query(`ALTER TABLE "invoices" ADD "void_reason" text`);
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "overdue_notified_at" TIMESTAMP WITH TIME ZONE`,
    );

    // Close the check-then-insert race between the Temporal activity and the
    // Nest-side fallback both trying to create an invoice for the same quote.
    await queryRunner.query(`DROP INDEX "idx_invoices_quote_id"`);
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "UQ_invoices_quote_id" UNIQUE ("quote_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "invoice_payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "invoice_id" uuid NOT NULL, "amount" numeric(12,2) NOT NULL, "paid_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "account_id" uuid, "recorded_by_id" uuid, "notes" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_invoice_payments_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_invoice_payments_tenant_id" ON "invoice_payments" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_invoice_payments_invoice_id" ON "invoice_payments" ("invoice_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_payments" ADD CONSTRAINT "FK_invoice_payments_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_payments" ADD CONSTRAINT "FK_invoice_payments_invoice_id" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_payments" ADD CONSTRAINT "FK_invoice_payments_account_id" FOREIGN KEY ("account_id") REFERENCES "finance_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_payments" DROP CONSTRAINT "FK_invoice_payments_account_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_payments" DROP CONSTRAINT "FK_invoice_payments_invoice_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_payments" DROP CONSTRAINT "FK_invoice_payments_tenant_id"`,
    );
    await queryRunner.query(`DROP INDEX "idx_invoice_payments_invoice_id"`);
    await queryRunner.query(`DROP INDEX "idx_invoice_payments_tenant_id"`);
    await queryRunner.query(`DROP TABLE "invoice_payments"`);

    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "UQ_invoices_quote_id"`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_invoices_quote_id" ON "invoices" ("quote_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN "overdue_notified_at"`,
    );
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "void_reason"`);
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN "voided_by_id"`,
    );
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "voided_at"`);

    // Postgres has no DROP VALUE for enums — 'PARTIALLY_PAID'/'CANCELLED'
    // intentionally remain on rollback. Standard, low-risk limitation for
    // additive enum migrations.
  }
}
