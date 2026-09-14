import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stock: locations, the movement ledger, the cached position, and goods
 * receipts. S3 band (1786500000000–1786590000000).
 *
 * `stock_movements` is append-only and has no `deletedAt` on purpose — it is
 * the source of truth that `stock_items` is projected from, and a correction
 * is another movement rather than an edit.
 */
export class CreateInventoryTables1786500000000 implements MigrationInterface {
  name = 'CreateInventoryTables1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "stock_locations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "tenant_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "is_default" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_stock_locations" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_stock_locations_tenant" ON "stock_locations" ("tenant_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_locations" ADD CONSTRAINT "FK_stock_locations_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE`,
    );
    // At most one default per tenant, so "where does this go" always has one answer.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_stock_locations_one_default" ON "stock_locations" ("tenant_id") WHERE "is_default" = true AND "deletedAt" IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "stock_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "material_id" uuid NOT NULL,
        "location_id" uuid NOT NULL,
        "qty_on_hand" numeric(14,4) NOT NULL DEFAULT '0',
        "qty_reserved" numeric(14,4) NOT NULL DEFAULT '0',
        "qty_on_order" numeric(14,4) NOT NULL DEFAULT '0',
        "avg_unit_cost" numeric(14,4) NOT NULL DEFAULT '0',
        "reorder_point" numeric(14,4),
        "reorder_qty" numeric(14,4),
        CONSTRAINT "PK_stock_items" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_stock_items_tenant" ON "stock_items" ("tenant_id")`,
    );
    // The unique key the receipt path locks on: one row per material per
    // location, so concurrent receipts contend rather than double-count.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_stock_items_material_location" ON "stock_items" ("tenant_id", "material_id", "location_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_items" ADD CONSTRAINT "FK_stock_items_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_items" ADD CONSTRAINT "FK_stock_items_material" FOREIGN KEY ("material_id") REFERENCES "catalog_materials"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_items" ADD CONSTRAINT "FK_stock_items_location" FOREIGN KEY ("location_id") REFERENCES "stock_locations"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(`
      CREATE TABLE "stock_movements" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "material_id" uuid NOT NULL,
        "location_id" uuid NOT NULL,
        "type" character varying(20) NOT NULL,
        "qty_delta" numeric(14,4) NOT NULL,
        "unit_cost" numeric(14,4) NOT NULL DEFAULT '0',
        "avg_unit_cost_after" numeric(14,4) NOT NULL DEFAULT '0',
        "qty_on_hand_after" numeric(14,4) NOT NULL DEFAULT '0',
        "reference_type" character varying(30) NOT NULL DEFAULT 'MANUAL',
        "reference_id" uuid,
        "actor_id" uuid,
        "note" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stock_movements" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_stock_movements_tenant_material" ON "stock_movements" ("tenant_id", "material_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_stock_movements_reference" ON "stock_movements" ("reference_type", "reference_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_movements" ADD CONSTRAINT "FK_stock_movements_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(`
      CREATE TABLE "goods_receipts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "tenant_id" uuid NOT NULL,
        "receipt_number" character varying(40) NOT NULL,
        "purchase_order_id" uuid NOT NULL,
        "location_id" uuid NOT NULL,
        "received_by_id" uuid,
        "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "supplier_reference" character varying(120),
        "notes" text,
        "total_value" numeric(12,2) NOT NULL DEFAULT '0',
        "journal_entry_id" uuid,
        CONSTRAINT "PK_goods_receipts" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_goods_receipts_tenant" ON "goods_receipts" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_goods_receipts_po" ON "goods_receipts" ("purchase_order_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_goods_receipts_tenant_number" ON "goods_receipts" ("tenant_id", "receipt_number") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "goods_receipts" ADD CONSTRAINT "FK_goods_receipts_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "goods_receipts" ADD CONSTRAINT "FK_goods_receipts_po" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(`
      CREATE TABLE "goods_receipt_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "goods_receipt_id" uuid NOT NULL,
        "purchase_order_line_id" uuid NOT NULL,
        "material_id" uuid,
        "description" character varying(255) NOT NULL,
        "qty_received" numeric(14,4) NOT NULL DEFAULT '0',
        "qty_rejected" numeric(14,4) NOT NULL DEFAULT '0',
        "unit_cost" numeric(14,4) NOT NULL DEFAULT '0',
        "stock_movement_id" uuid,
        CONSTRAINT "PK_goods_receipt_lines" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_goods_receipt_lines_receipt" ON "goods_receipt_lines" ("goods_receipt_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "FK_goods_receipt_lines_receipt" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "FK_goods_receipt_lines_po_line" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT`,
    );

    // Every remaining journal reference type, added together.
    //
    // Only 'STOCK' is used this sprint; 'BILL', 'WORK_ORDER' and 'CREDIT_NOTE'
    // arrive in sprints 4, 6 and 7. Declaring them now costs nothing - an
    // unused enum label occupies no rows - and avoids three more branches each
    // altering the same type. Postgres 12+ permits ADD VALUE inside a
    // transaction provided the new label is not *used* in the same one, which
    // is exactly the case here.
    for (const value of ['STOCK', 'BILL', 'WORK_ORDER', 'CREDIT_NOTE']) {
      await queryRunner.query(
        `ALTER TYPE "journal_entries_reference_type_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres cannot drop a single enum value; the label is left in place.
    await queryRunner.query(`DROP TABLE "goods_receipt_lines"`);
    await queryRunner.query(`DROP TABLE "goods_receipts"`);
    await queryRunner.query(`DROP TABLE "stock_movements"`);
    await queryRunner.query(`DROP TABLE "stock_items"`);
    await queryRunner.query(`DROP TABLE "stock_locations"`);
  }
}
