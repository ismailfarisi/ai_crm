import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 1 of the costing quote engine: the cost primitives (materials, work
 * centres, tooling), flat catalog items, and versioned parametric product
 * templates.
 *
 * `product_templates` has no `deletedAt` on purpose — a quote references a
 * specific version and that row must never disappear. Retiring a template
 * flips `is_current` instead.
 */
export class CreateCatalogAndCostingTables1786180000000 implements MigrationInterface {
  name = 'CreateCatalogAndCostingTables1786180000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "catalog_materials" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "tenant_id" uuid NOT NULL,
        "sku" character varying(60),
        "name" character varying(160) NOT NULL,
        "uom" character varying(10) NOT NULL,
        "cost_per_uom" numeric(14,4) NOT NULL DEFAULT '0',
        "sheet_width_mm" numeric(10,2),
        "sheet_height_mm" numeric(10,2),
        "grain" character varying(10) NOT NULL DEFAULT 'NONE',
        "waste_pct" numeric(5,4) NOT NULL DEFAULT '0',
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_catalog_materials_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "catalog_work_centers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "tenant_id" uuid NOT NULL,
        "name" character varying(160) NOT NULL,
        "setup_minutes" numeric(10,2) NOT NULL DEFAULT '0',
        "machine_cost_per_hour" numeric(12,4) NOT NULL DEFAULT '0',
        "labor_cost_per_hour" numeric(12,4) NOT NULL DEFAULT '0',
        "scrap_pct" numeric(5,4) NOT NULL DEFAULT '0',
        "min_charge_minutes" numeric(10,2) NOT NULL DEFAULT '0',
        "daily_capacity_minutes" numeric(10,2) NOT NULL DEFAULT '480',
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_catalog_work_centers_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "catalog_tooling" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "tenant_id" uuid NOT NULL,
        "name" character varying(160) NOT NULL,
        "cost" numeric(12,2) NOT NULL DEFAULT '0',
        "amortize" boolean NOT NULL DEFAULT true,
        "reusable" boolean NOT NULL DEFAULT true,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_catalog_tooling_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "catalog_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "tenant_id" uuid NOT NULL,
        "sku" character varying(60) NOT NULL,
        "name" character varying(200) NOT NULL,
        "description" text,
        "uom" character varying(40) NOT NULL DEFAULT 'Units',
        "list_price" numeric(12,2) NOT NULL DEFAULT '0',
        "standard_cost" numeric(14,4) NOT NULL DEFAULT '0',
        "tax_rate" numeric(5,2) NOT NULL DEFAULT '0',
        "lead_time_days" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_catalog_items_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "product_templates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "template_key" character varying(60) NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "is_current" boolean NOT NULL DEFAULT true,
        "name" character varying(200) NOT NULL,
        "description" text,
        "currency" character(3) NOT NULL DEFAULT 'USD',
        "parameters" jsonb NOT NULL DEFAULT '[]',
        "derived" jsonb NOT NULL DEFAULT '[]',
        "materials" jsonb NOT NULL DEFAULT '[]',
        "operations" jsonb NOT NULL DEFAULT '[]',
        "tooling" jsonb NOT NULL DEFAULT '[]',
        "pricing" jsonb NOT NULL,
        "created_by_id" uuid,
        CONSTRAINT "PK_product_templates_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "idx_catalog_materials_tenant" ON "catalog_materials" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_catalog_work_centers_tenant" ON "catalog_work_centers" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_catalog_tooling_tenant" ON "catalog_tooling" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_catalog_items_tenant" ON "catalog_items" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_product_templates_tenant" ON "product_templates" ("tenant_id")`,
    );

    // Partial uniques so a soft-deleted row frees its SKU for reuse.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_catalog_materials_tenant_sku" ON "catalog_materials" ("tenant_id", "sku") WHERE "sku" IS NOT NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_catalog_items_tenant_sku" ON "catalog_items" ("tenant_id", "sku") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_product_templates_tenant_key_version" ON "product_templates" ("tenant_id", "template_key", "version")`,
    );

    for (const table of [
      'catalog_materials',
      'catalog_work_centers',
      'catalog_tooling',
      'catalog_items',
      'product_templates',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "FK_${table}_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "product_templates" ADD CONSTRAINT "FK_product_templates_created_by_id" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "product_templates"`);
    await queryRunner.query(`DROP TABLE "catalog_items"`);
    await queryRunner.query(`DROP TABLE "catalog_tooling"`);
    await queryRunner.query(`DROP TABLE "catalog_work_centers"`);
    await queryRunner.query(`DROP TABLE "catalog_materials"`);
  }
}
