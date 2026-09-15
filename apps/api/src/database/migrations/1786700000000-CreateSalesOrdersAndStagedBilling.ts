import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sales orders, staged billing, and customer acceptance of quotes. S5 band.
 *
 * Until now an approved quote became exactly one invoice, and
 * `UQ_invoices_quote_id` enforced that. The constraint was doing a second,
 * less obvious job: the synchronous approval path and the Temporal activity
 * both try to create that invoice, and the unique index decided which one
 * won. A quote billed as a deposit plus a balance needs two invoices, so the
 * index has to go — and its idempotency job moves to two new constraints that
 * say the same thing more precisely:
 *
 * - `uq_sales_orders_quote`: one order per quote, however many paths race.
 * - `uq_invoices_billing_line`: one invoice per billing stage.
 *
 * Every existing invoice is backfilled into an order with a single 100% stage,
 * so an old quote looks exactly like a new one billed in full.
 */
export class CreateSalesOrdersAndStagedBilling1786700000000 implements MigrationInterface {
  name = 'CreateSalesOrdersAndStagedBilling1786700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    /* ---------------- quotes: schedule, acceptance, revisions ---------------- */
    await queryRunner.query(`
      ALTER TABLE "quotes"
        ADD "billing_schedule" jsonb,
        ADD "acceptance_token_hash" character varying(64),
        ADD "acceptance_expires_at" TIMESTAMP WITH TIME ZONE,
        ADD "accepted_at" TIMESTAMP WITH TIME ZONE,
        ADD "accepted_by_name" character varying(255),
        ADD "accepted_ip" character varying(64),
        ADD "version" integer NOT NULL DEFAULT 1,
        ADD "parent_quote_id" uuid,
        ADD "superseded_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_quotes_acceptance_token" ON "quotes" ("acceptance_token_hash") WHERE "acceptance_token_hash" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_quotes_parent" ON "quotes" ("parent_quote_id")`,
    );

    /* ---------------- sales orders ---------------- */
    await queryRunner.query(`
      CREATE TABLE "sales_orders" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "order_number" character varying(40) NOT NULL,
        "quote_id" uuid NOT NULL,
        "quote_number" character varying(60),
        "customer_id" uuid,
        "customer_name" character varying(255) NOT NULL,
        "customer_email" character varying(255),
        "status" character varying(20) NOT NULL DEFAULT 'OPEN',
        "currency" character(3) NOT NULL DEFAULT 'USD',
        "payment_terms" character varying(50) NOT NULL DEFAULT 'immediate',
        "subtotal_amount" numeric(12,2) NOT NULL DEFAULT '0',
        "discount_amount" numeric(12,2) NOT NULL DEFAULT '0',
        "tax_amount" numeric(12,2) NOT NULL DEFAULT '0',
        "total_amount" numeric(12,2) NOT NULL DEFAULT '0',
        "notes" text,
        "cancelled_at" TIMESTAMP WITH TIME ZONE,
        "cancel_reason" text,
        CONSTRAINT "PK_sales_orders" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_sales_orders_tenant" ON "sales_orders" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_sales_orders_quote" ON "sales_orders" ("quote_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_sales_orders_tenant_number" ON "sales_orders" ("tenant_id", "order_number")`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_orders" ADD CONSTRAINT "FK_sales_orders_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_orders" ADD CONSTRAINT "FK_sales_orders_quote" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(`
      CREATE TABLE "sales_order_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "sales_order_id" uuid NOT NULL,
        "sequence" integer NOT NULL,
        "quote_line_id" character varying(100),
        "catalog_item_id" uuid,
        "description" text NOT NULL,
        "uom" character varying(40),
        "qty_ordered" numeric(14,4) NOT NULL,
        "qty_fulfilled" numeric(14,4) NOT NULL DEFAULT '0',
        "unit_price" numeric(14,4) NOT NULL DEFAULT '0',
        "line_total" numeric(12,2) NOT NULL DEFAULT '0',
        CONSTRAINT "PK_sales_order_lines" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_sales_order_lines_order" ON "sales_order_lines" ("sales_order_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_order_lines" ADD CONSTRAINT "FK_sales_order_lines_order" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(`
      CREATE TABLE "billing_schedule_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "sales_order_id" uuid NOT NULL,
        "sequence" integer NOT NULL,
        "kind" character varying(20) NOT NULL,
        "label" character varying(120) NOT NULL,
        "percent" numeric(7,3) NOT NULL,
        "trigger" character varying(20) NOT NULL,
        "subtotal_amount" numeric(12,2) NOT NULL DEFAULT '0',
        "discount_amount" numeric(12,2) NOT NULL DEFAULT '0',
        "tax_amount" numeric(12,2) NOT NULL DEFAULT '0',
        "total_amount" numeric(12,2) NOT NULL DEFAULT '0',
        "invoice_id" uuid,
        "invoiced_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_billing_schedule_lines" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_billing_schedule_lines_percent" CHECK ("percent" > 0 AND "percent" <= 100)
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_billing_schedule_lines_order_seq" ON "billing_schedule_lines" ("sales_order_id", "sequence")`,
    );
    await queryRunner.query(
      `ALTER TABLE "billing_schedule_lines" ADD CONSTRAINT "FK_billing_schedule_lines_order" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE`,
    );

    /* ---------------- invoices ---------------- */
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_invoices_quote_id"`);
    await queryRunner.query(
      `CREATE INDEX "idx_invoices_quote" ON "invoices" ("quote_id")`,
    );
    await queryRunner.query(`
      ALTER TABLE "invoices"
        ADD "sales_order_id" uuid,
        ADD "billing_schedule_line_id" uuid,
        ADD "stage_label" character varying(120)`);
    await queryRunner.query(
      `CREATE INDEX "idx_invoices_sales_order" ON "invoices" ("sales_order_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_invoices_billing_line" ON "invoices" ("billing_schedule_line_id") WHERE "billing_schedule_line_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "FK_invoices_sales_order" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "FK_invoices_billing_line" FOREIGN KEY ("billing_schedule_line_id") REFERENCES "billing_schedule_lines"("id") ON DELETE RESTRICT`,
    );

    /* ---------------- backfill ---------------- */
    // One order per invoiced quote. Numbered per tenant in the order the
    // invoices were issued, continuing from any sales_order_number already
    // allocated (none should be, but a re-run must not collide).
    await queryRunner.query(`
      WITH numbered AS (
        SELECT i.*,
               q."quote_number" AS q_number,
               ROW_NUMBER() OVER (PARTITION BY i."tenant_id" ORDER BY i."issued_at", i."id")
                 + COALESCE((SELECT ts."current_value" FROM "tenant_sequences" ts
                             WHERE ts."tenant_id" = i."tenant_id"
                               AND ts."sequence_name" = 'sales_order_number'), 0) AS seq
        FROM "invoices" i
        JOIN "quotes" q ON q."id" = i."quote_id"
        WHERE i."sales_order_id" IS NULL
      )
      INSERT INTO "sales_orders" (
        "tenant_id", "order_number", "quote_id", "quote_number", "customer_id",
        "customer_name", "customer_email", "status", "currency", "payment_terms",
        "subtotal_amount", "discount_amount", "tax_amount", "total_amount",
        "createdAt", "updatedAt", "cancelled_at"
      )
      SELECT n."tenant_id",
             'SO-' || EXTRACT(YEAR FROM n."issued_at")::int || '-' || LPAD(n.seq::text, 4, '0'),
             n."quote_id", n.q_number, n."customer_id", n."customer_name", n."customer_email",
             CASE n."status"::text
               WHEN 'PAID' THEN 'CLOSED'
               WHEN 'CANCELLED' THEN 'CANCELLED'
               ELSE 'OPEN' END,
             n."currency", n."payment_terms",
             n."subtotal_amount", n."discount_amount", n."tax_amount", n."amount",
             n."issued_at", n."issued_at",
             CASE WHEN n."status"::text = 'CANCELLED' THEN n."voided_at" END
      FROM numbered n
      ON CONFLICT ("quote_id") DO NOTHING`);

    await queryRunner.query(`
      INSERT INTO "tenant_sequences" ("tenant_id", "sequence_name", "current_value")
      SELECT "tenant_id", 'sales_order_number', COUNT(*)
      FROM "sales_orders"
      GROUP BY "tenant_id"
      ON CONFLICT ("tenant_id", "sequence_name")
      DO UPDATE SET "current_value" = GREATEST("tenant_sequences"."current_value", EXCLUDED."current_value"),
                    "updated_at" = now()`);

    await queryRunner.query(`
      INSERT INTO "sales_order_lines" (
        "tenant_id", "sales_order_id", "sequence", "quote_line_id", "catalog_item_id",
        "description", "uom", "qty_ordered", "unit_price", "line_total"
      )
      SELECT so."tenant_id", so."id", item.ord::int, item.value->>'id',
             CASE WHEN (item.value->>'catalogItemId') ~* '^[0-9a-f-]{36}$'
                  THEN (item.value->>'catalogItemId')::uuid END,
             COALESCE(NULLIF(item.value->>'description', ''), 'Item'),
             LEFT(item.value->>'uom', 40),
             COALESCE(NULLIF(item.value->>'quantity', '')::numeric, 1),
             COALESCE(NULLIF(item.value->>'unitPrice', '')::numeric, 0),
             ROUND(COALESCE(NULLIF(item.value->>'subtotal', '')::numeric, 0), 2)
      FROM "sales_orders" so
      JOIN "quotes" q ON q."id" = so."quote_id"
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(q."items", '[]'::jsonb)) WITH ORDINALITY AS item(value, ord)
      WHERE COALESCE(item.value->>'type', 'product') = 'product'
        AND NOT EXISTS (SELECT 1 FROM "sales_order_lines" l WHERE l."sales_order_id" = so."id")`);

    await queryRunner.query(`
      INSERT INTO "billing_schedule_lines" (
        "tenant_id", "sales_order_id", "sequence", "kind", "label", "percent", "trigger",
        "subtotal_amount", "discount_amount", "tax_amount", "total_amount",
        "invoice_id", "invoiced_at"
      )
      SELECT i."tenant_id", so."id", 1, 'FINAL', 'Full amount', 100, 'ON_APPROVAL',
             i."subtotal_amount", i."discount_amount", i."tax_amount", i."amount",
             i."id", i."issued_at"
      FROM "invoices" i
      JOIN "sales_orders" so ON so."quote_id" = i."quote_id"
      WHERE i."billing_schedule_line_id" IS NULL
      ON CONFLICT ("sales_order_id", "sequence") DO NOTHING`);

    await queryRunner.query(`
      UPDATE "invoices" i
      SET "sales_order_id" = b."sales_order_id",
          "billing_schedule_line_id" = b."id",
          "stage_label" = b."label"
      FROM "billing_schedule_lines" b
      WHERE b."invoice_id" = i."id" AND i."billing_schedule_line_id" IS NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Refuses rather than silently keeping one invoice per quote: once a quote
    // has been billed in stages, the old unique index cannot be put back.
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM "invoices" GROUP BY "quote_id" HAVING COUNT(*) > 1) THEN
          RAISE EXCEPTION 'Some quotes have more than one invoice; cannot restore UQ_invoices_quote_id';
        END IF;
      END $$`);
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "FK_invoices_billing_line"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "FK_invoices_sales_order"`,
    );
    await queryRunner.query(`DROP INDEX "uq_invoices_billing_line"`);
    await queryRunner.query(`DROP INDEX "idx_invoices_sales_order"`);
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN "stage_label", DROP COLUMN "billing_schedule_line_id", DROP COLUMN "sales_order_id"`,
    );
    await queryRunner.query(`DROP INDEX "idx_invoices_quote"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_invoices_quote_id" ON "invoices" ("quote_id")`,
    );
    await queryRunner.query(`DROP TABLE "billing_schedule_lines"`);
    await queryRunner.query(`DROP TABLE "sales_order_lines"`);
    await queryRunner.query(`DROP TABLE "sales_orders"`);
    await queryRunner.query(
      `DELETE FROM "tenant_sequences" WHERE "sequence_name" = 'sales_order_number'`,
    );
    await queryRunner.query(`DROP INDEX "idx_quotes_parent"`);
    await queryRunner.query(`DROP INDEX "uq_quotes_acceptance_token"`);
    await queryRunner.query(`
      ALTER TABLE "quotes"
        DROP COLUMN "superseded_at", DROP COLUMN "parent_quote_id", DROP COLUMN "version",
        DROP COLUMN "accepted_ip", DROP COLUMN "accepted_by_name", DROP COLUMN "accepted_at",
        DROP COLUMN "acceptance_expires_at", DROP COLUMN "acceptance_token_hash",
        DROP COLUMN "billing_schedule"`);
  }
}
