import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Credit notes and refunds, delivery notes, tax codes and tax rules. S7 band.
 *
 * The `CREDIT_NOTE` journal reference type and the `credit_note_number` and
 * `delivery_note_number` sequences were pre-allocated by earlier sprints.
 *
 * Data: each distinct `catalog_items.tax_rate` becomes a SALES tax code for
 * its tenant, and the item points at it. The flat rate column stays
 * populated for one release, as the plan requires, so anything still reading
 * it keeps working while callers move to the code.
 */
export class CreateCreditsDeliveriesAndTax1786900000000 implements MigrationInterface {
  name = 'CreateCreditsDeliveriesAndTax1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    /* ---------------- tax ---------------- */
    await queryRunner.query(`
      CREATE TABLE "tax_codes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(20) NOT NULL,
        "name" character varying(120) NOT NULL,
        "rate" numeric(7,4) NOT NULL,
        "kind" character varying(20) NOT NULL,
        "is_reverse_charge" boolean NOT NULL DEFAULT false,
        "ledger_account_id" uuid,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_tax_codes" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_tax_codes_rate" CHECK ("rate" >= 0 AND "rate" <= 100),
        CONSTRAINT "CHK_tax_codes_reverse_charge_zero" CHECK (NOT "is_reverse_charge" OR "rate" = 0)
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_tax_codes_tenant_kind_code" ON "tax_codes" ("tenant_id", "kind", "code")`,
    );
    await queryRunner.query(
      `ALTER TABLE "tax_codes" ADD CONSTRAINT "FK_tax_codes_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "tax_codes" ADD CONSTRAINT "FK_tax_codes_ledger_account" FOREIGN KEY ("ledger_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(`
      CREATE TABLE "tax_rules" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "kind" character varying(20) NOT NULL,
        "country" character varying(2) NOT NULL,
        "requires_tax_id" boolean NOT NULL DEFAULT false,
        "tax_code_id" uuid NOT NULL,
        "priority" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_tax_rules" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_tax_rules_tenant_match" ON "tax_rules" ("tenant_id", "kind", "country", "requires_tax_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "tax_rules" ADD CONSTRAINT "FK_tax_rules_code" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(`
      ALTER TABLE "catalog_items"
        ADD "tax_code_id" uuid,
        ADD "stock_material_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "supplier_bills" ADD "tax_code_id" uuid`,
    );

    /* ---------------- invoices ---------------- */
    await queryRunner.query(`
      ALTER TABLE "invoices"
        ADD "tax_breakdown" jsonb,
        ADD "credited_amount" numeric(12,2) NOT NULL DEFAULT '0',
        ADD "refunded_amount" numeric(12,2) NOT NULL DEFAULT '0',
        ADD "delivery_note_id" uuid`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_invoices_delivery_note" ON "invoices" ("delivery_note_id") WHERE "delivery_note_id" IS NOT NULL`,
    );

    /* ---------------- credit notes ---------------- */
    await queryRunner.query(`
      CREATE TABLE "credit_notes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "credit_note_number" character varying(40),
        "status" character varying(20) NOT NULL DEFAULT 'DRAFT',
        "invoice_id" uuid NOT NULL,
        "customer_id" uuid,
        "customer_name" character varying(255) NOT NULL,
        "currency" character(3) NOT NULL DEFAULT 'USD',
        "reason" text NOT NULL,
        "subtotal_amount" numeric(12,2) NOT NULL DEFAULT '0',
        "tax_amount" numeric(12,2) NOT NULL DEFAULT '0',
        "total_amount" numeric(12,2) NOT NULL DEFAULT '0',
        "refunded_amount" numeric(12,2) NOT NULL DEFAULT '0',
        "tax_breakdown" jsonb NOT NULL DEFAULT '[]',
        "issued_at" TIMESTAMP WITH TIME ZONE,
        "issued_by_id" uuid,
        "created_by_id" uuid,
        "cancelled_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_credit_notes" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_credit_notes_positive" CHECK ("total_amount" > 0),
        CONSTRAINT "CHK_credit_notes_refund_le_total" CHECK ("refunded_amount" <= "total_amount")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_credit_notes_tenant" ON "credit_notes" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_credit_notes_invoice" ON "credit_notes" ("invoice_id")`,
    );
    // Numbered on issue, not on draft, so an abandoned draft leaves no gap.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_credit_notes_tenant_number" ON "credit_notes" ("tenant_id", "credit_note_number") WHERE "credit_note_number" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_notes" ADD CONSTRAINT "FK_credit_notes_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_notes" ADD CONSTRAINT "FK_credit_notes_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(`
      CREATE TABLE "credit_note_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "credit_note_id" uuid NOT NULL,
        "sequence" integer NOT NULL,
        "description" character varying(500) NOT NULL,
        "qty" numeric(14,4) NOT NULL,
        "unit_price" numeric(14,4) NOT NULL,
        "net" numeric(12,2) NOT NULL,
        "tax_rate" numeric(7,4) NOT NULL DEFAULT '0',
        "tax_code_id" uuid,
        "tax_code" character varying(20),
        "reverse_charge" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_credit_note_lines" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_credit_note_lines_note" ON "credit_note_lines" ("credit_note_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_note_lines" ADD CONSTRAINT "FK_credit_note_lines_note" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(`
      CREATE TABLE "credit_note_refunds" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "credit_note_id" uuid NOT NULL,
        "invoice_id" uuid NOT NULL,
        "finance_account_id" uuid NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "reference" character varying(120),
        "refunded_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "recorded_by_id" uuid,
        CONSTRAINT "PK_credit_note_refunds" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_credit_note_refunds_positive" CHECK ("amount" > 0)
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_credit_note_refunds_note" ON "credit_note_refunds" ("credit_note_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_note_refunds" ADD CONSTRAINT "FK_credit_note_refunds_note" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_note_refunds" ADD CONSTRAINT "FK_credit_note_refunds_account" FOREIGN KEY ("finance_account_id") REFERENCES "finance_accounts"("id") ON DELETE RESTRICT`,
    );

    /* ---------------- delivery notes ---------------- */
    await queryRunner.query(`
      CREATE TABLE "delivery_notes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "delivery_note_number" character varying(40) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'DRAFT',
        "sales_order_id" uuid NOT NULL,
        "customer_name" character varying(255) NOT NULL,
        "ship_to" text,
        "carrier" character varying(120),
        "tracking_reference" character varying(120),
        "notes" text,
        "dispatched_at" TIMESTAMP WITH TIME ZONE,
        "dispatched_by_id" uuid,
        "cancelled_at" TIMESTAMP WITH TIME ZONE,
        "created_by_id" uuid,
        CONSTRAINT "PK_delivery_notes" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_delivery_notes_order" ON "delivery_notes" ("sales_order_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_delivery_notes_tenant_number" ON "delivery_notes" ("tenant_id", "delivery_note_number")`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_notes" ADD CONSTRAINT "FK_delivery_notes_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_notes" ADD CONSTRAINT "FK_delivery_notes_order" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(`
      CREATE TABLE "delivery_note_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "delivery_note_id" uuid NOT NULL,
        "sales_order_line_id" uuid NOT NULL,
        "description" text NOT NULL,
        "uom" character varying(40),
        "qty" numeric(14,4) NOT NULL,
        "stock_material_id" uuid,
        "stock_movement_id" uuid,
        CONSTRAINT "PK_delivery_note_lines" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_delivery_note_lines_qty" CHECK ("qty" > 0)
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_delivery_note_lines_note" ON "delivery_note_lines" ("delivery_note_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_delivery_note_lines_order_line" ON "delivery_note_lines" ("sales_order_line_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "FK_delivery_note_lines_note" FOREIGN KEY ("delivery_note_id") REFERENCES "delivery_notes"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "FK_delivery_note_lines_order_line" FOREIGN KEY ("sales_order_line_id") REFERENCES "sales_order_lines"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "FK_invoices_delivery_note" FOREIGN KEY ("delivery_note_id") REFERENCES "delivery_notes"("id") ON DELETE RESTRICT`,
    );

    /* ---------------- data: flat rates become codes ---------------- */
    await queryRunner.query(`
      INSERT INTO "tax_codes" ("tenant_id", "code", "name", "rate", "kind")
      SELECT DISTINCT "tenant_id",
             CASE WHEN "tax_rate" = 0 THEN 'ZERO' ELSE 'R' || trim(to_char("tax_rate", 'FM990.99'), '.') END,
             CASE WHEN "tax_rate" = 0 THEN 'Zero rated' ELSE trim(to_char("tax_rate", 'FM990.99'), '.') || '%' END,
             "tax_rate",
             'SALES'
      FROM "catalog_items"
      WHERE "tax_rate" IS NOT NULL
      ON CONFLICT ("tenant_id", "kind", "code") DO NOTHING`);
    await queryRunner.query(`
      UPDATE "catalog_items" ci
      SET "tax_code_id" = tc."id"
      FROM "tax_codes" tc
      WHERE tc."tenant_id" = ci."tenant_id"
        AND tc."kind" = 'SALES'
        AND tc."rate" = ci."tax_rate"
        AND NOT tc."is_reverse_charge"
        AND ci."tax_code_id" IS NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "FK_invoices_delivery_note"`,
    );
    await queryRunner.query(`DROP TABLE "delivery_note_lines"`);
    await queryRunner.query(`DROP TABLE "delivery_notes"`);
    await queryRunner.query(`DROP TABLE "credit_note_refunds"`);
    await queryRunner.query(`DROP TABLE "credit_note_lines"`);
    await queryRunner.query(`DROP TABLE "credit_notes"`);
    await queryRunner.query(`DROP INDEX "uq_invoices_delivery_note"`);
    await queryRunner.query(`
      ALTER TABLE "invoices"
        DROP COLUMN "delivery_note_id", DROP COLUMN "refunded_amount",
        DROP COLUMN "credited_amount", DROP COLUMN "tax_breakdown"`);
    await queryRunner.query(
      `ALTER TABLE "supplier_bills" DROP COLUMN "tax_code_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalog_items" DROP COLUMN "stock_material_id", DROP COLUMN "tax_code_id"`,
    );
    await queryRunner.query(`DROP TABLE "tax_rules"`);
    await queryRunner.query(`DROP TABLE "tax_codes"`);
    await queryRunner.query(
      `DELETE FROM "tenant_sequences" WHERE "sequence_name" IN ('credit_note_number', 'delivery_note_number')`,
    );
  }
}
