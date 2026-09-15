import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Supplier bills, their lines, and payments against them. S4 band.
 *
 * The journal reference type 'BILL' already exists — it was added with the
 * inventory tables precisely so this migration would not have to alter it.
 */
export class CreatePayablesTables1786600000000 implements MigrationInterface {
  name = 'CreatePayablesTables1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "supplier_bills" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "tenant_id" uuid NOT NULL,
        "bill_number" character varying(40) NOT NULL,
        "supplier_invoice_number" character varying(80) NOT NULL,
        "supplier_id" uuid NOT NULL,
        "supplier_name" character varying(120) NOT NULL,
        "purchase_order_id" uuid,
        "status" character varying(20) NOT NULL DEFAULT 'DRAFT',
        "match_status" character varying(20) NOT NULL DEFAULT 'UNMATCHED',
        "currency" character(3) NOT NULL DEFAULT 'USD',
        "bill_date" TIMESTAMP WITH TIME ZONE NOT NULL,
        "due_date" TIMESTAMP WITH TIME ZONE,
        "subtotal_amount" numeric(12,2) NOT NULL DEFAULT '0',
        "tax_amount" numeric(12,2) NOT NULL DEFAULT '0',
        "total_amount" numeric(12,2) NOT NULL DEFAULT '0',
        "paid_amount" numeric(12,2) NOT NULL DEFAULT '0',
        "notes" text,
        "created_by_id" uuid,
        "approved_at" TIMESTAMP WITH TIME ZONE,
        "approved_by_id" uuid,
        "variance_approved" boolean NOT NULL DEFAULT false,
        "dispute_reason" text,
        "journal_entry_id" uuid,
        CONSTRAINT "PK_supplier_bills" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_supplier_bills_paid_le_total" CHECK ("paid_amount" <= "total_amount")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_supplier_bills_tenant" ON "supplier_bills" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_supplier_bills_po" ON "supplier_bills" ("purchase_order_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_supplier_bills_tenant_number" ON "supplier_bills" ("tenant_id", "bill_number") WHERE "deletedAt" IS NULL`,
    );
    // Entering the same supplier invoice twice is the commonest way to pay twice.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_supplier_bills_supplier_invoice" ON "supplier_bills" ("tenant_id", "supplier_id", "supplier_invoice_number") WHERE "deletedAt" IS NULL AND "status" <> 'CANCELLED'`,
    );
    await queryRunner.query(
      `ALTER TABLE "supplier_bills" ADD CONSTRAINT "FK_supplier_bills_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "supplier_bills" ADD CONSTRAINT "FK_supplier_bills_supplier" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "supplier_bills" ADD CONSTRAINT "FK_supplier_bills_po" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(`
      CREATE TABLE "supplier_bill_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "bill_id" uuid NOT NULL,
        "purchase_order_line_id" uuid,
        "description" character varying(255) NOT NULL,
        "qty" numeric(14,4) NOT NULL,
        "unit_cost" numeric(14,4) NOT NULL,
        "order_unit_cost" numeric(14,4),
        "line_total" numeric(12,2) NOT NULL DEFAULT '0',
        CONSTRAINT "PK_supplier_bill_lines" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_supplier_bill_lines_bill" ON "supplier_bill_lines" ("bill_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_supplier_bill_lines_po_line" ON "supplier_bill_lines" ("purchase_order_line_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "FK_supplier_bill_lines_bill" FOREIGN KEY ("bill_id") REFERENCES "supplier_bills"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "FK_supplier_bill_lines_po_line" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(`
      CREATE TABLE "bill_payments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "bill_id" uuid NOT NULL,
        "finance_account_id" uuid NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "paid_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "reference" character varying(120),
        "recorded_by_id" uuid,
        "journal_entry_id" uuid,
        "reversed_at" TIMESTAMP WITH TIME ZONE,
        "reversed_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bill_payments" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_bill_payments_positive" CHECK ("amount" > 0)
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_bill_payments_bill" ON "bill_payments" ("bill_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "bill_payments" ADD CONSTRAINT "FK_bill_payments_bill" FOREIGN KEY ("bill_id") REFERENCES "supplier_bills"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "bill_payments" ADD CONSTRAINT "FK_bill_payments_account" FOREIGN KEY ("finance_account_id") REFERENCES "finance_accounts"("id") ON DELETE RESTRICT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "bill_payments"`);
    await queryRunner.query(`DROP TABLE "supplier_bill_lines"`);
    await queryRunner.query(`DROP TABLE "supplier_bills"`);
  }
}
