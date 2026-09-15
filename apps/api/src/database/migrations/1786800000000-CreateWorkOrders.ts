import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Work orders, their operations and materials. S6 band.
 *
 * Needs nothing altered elsewhere: the `WORK_ORDER` journal reference type,
 * the `WORK_ORDER` stock reference type and the `work_order_number` sequence
 * were all pre-allocated by earlier sprints for exactly this.
 *
 * Estimates and rates are copied onto the rows rather than joined at read
 * time. A work order has to stay comparable to the quote it was built from
 * after someone edits a work centre's hourly rate, and product templates are
 * already immutable per version, so the template is referenced, not copied.
 */
export class CreateWorkOrders1786800000000 implements MigrationInterface {
  name = 'CreateWorkOrders1786800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "work_orders" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "wo_number" character varying(40) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'PLANNED',
        "sales_order_id" uuid,
        "sales_order_line_id" uuid,
        "description" text NOT NULL,
        "template_id" uuid,
        "template_key" character varying(60),
        "template_name" character varying(200),
        "template_version" integer,
        "parameters" jsonb NOT NULL DEFAULT '{}',
        "qty" numeric(14,4) NOT NULL,
        "qty_completed" numeric(14,4),
        "due_date" TIMESTAMP WITH TIME ZONE,
        "overhead_pct" numeric(7,4) NOT NULL DEFAULT '0',
        "quoted_unit_cost" numeric(14,4),
        "estimated_cost" jsonb,
        "actual_cost" jsonb,
        "released_at" TIMESTAMP WITH TIME ZONE,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "completed_by_id" uuid,
        "cancelled_at" TIMESTAMP WITH TIME ZONE,
        "cancel_reason" text,
        "created_by_id" uuid,
        CONSTRAINT "PK_work_orders" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_work_orders_qty" CHECK ("qty" > 0)
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_work_orders_tenant_status" ON "work_orders" ("tenant_id", "status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_work_orders_tenant_number" ON "work_orders" ("tenant_id", "wo_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_work_orders_sales_order" ON "work_orders" ("sales_order_id")`,
    );
    // One live job per order line. A cancelled job does not count, so a line
    // can be re-planned after a false start.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_work_orders_live_line" ON "work_orders" ("sales_order_line_id") WHERE "sales_order_line_id" IS NOT NULL AND "status" <> 'CANCELLED'`,
    );
    await queryRunner.query(
      `ALTER TABLE "work_orders" ADD CONSTRAINT "FK_work_orders_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "work_orders" ADD CONSTRAINT "FK_work_orders_sales_order" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "work_orders" ADD CONSTRAINT "FK_work_orders_sales_order_line" FOREIGN KEY ("sales_order_line_id") REFERENCES "sales_order_lines"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(`
      CREATE TABLE "work_order_operations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "work_order_id" uuid NOT NULL,
        "sequence" integer NOT NULL,
        "operation_key" character varying(60),
        "label" character varying(200) NOT NULL,
        "work_center_id" uuid NOT NULL,
        "work_center_name" character varying(160) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'PENDING',
        "estimated_setup_minutes" numeric(10,2) NOT NULL DEFAULT '0',
        "estimated_run_minutes" numeric(10,2) NOT NULL DEFAULT '0',
        "estimated_charged_minutes" numeric(10,2) NOT NULL DEFAULT '0',
        "actual_minutes" numeric(10,2) NOT NULL DEFAULT '0',
        "machine_cost_per_hour" numeric(12,4) NOT NULL DEFAULT '0',
        "labor_cost_per_hour" numeric(12,4) NOT NULL DEFAULT '0',
        "running_since" TIMESTAMP WITH TIME ZONE,
        "operator_id" uuid,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_work_order_operations" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_work_order_operations_minutes" CHECK ("actual_minutes" >= 0)
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_work_order_operations_order" ON "work_order_operations" ("work_order_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_work_order_operations_center" ON "work_order_operations" ("tenant_id", "work_center_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "work_order_operations" ADD CONSTRAINT "FK_work_order_operations_order" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(`
      CREATE TABLE "work_order_materials" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "work_order_id" uuid NOT NULL,
        "material_id" uuid NOT NULL,
        "material_name" character varying(200) NOT NULL,
        "uom" character varying(20) NOT NULL,
        "qty_planned" numeric(14,4) NOT NULL DEFAULT '0',
        "qty_issued" numeric(14,4) NOT NULL DEFAULT '0',
        "qty_returned" numeric(14,4) NOT NULL DEFAULT '0',
        "value_issued" numeric(14,4) NOT NULL DEFAULT '0',
        "estimated_unit_cost" numeric(14,4) NOT NULL DEFAULT '0',
        "last_stock_movement_id" uuid,
        CONSTRAINT "PK_work_order_materials" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_work_order_materials_returned" CHECK ("qty_returned" <= "qty_issued")
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_work_order_materials_order_material" ON "work_order_materials" ("work_order_id", "material_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "work_order_materials" ADD CONSTRAINT "FK_work_order_materials_order" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "work_order_materials"`);
    await queryRunner.query(`DROP TABLE "work_order_operations"`);
    await queryRunner.query(`DROP TABLE "work_orders"`);
    await queryRunner.query(
      `DELETE FROM "tenant_sequences" WHERE "sequence_name" = 'work_order_number'`,
    );
  }
}
