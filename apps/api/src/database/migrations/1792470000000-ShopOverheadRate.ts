import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One overhead rate for the whole shop, on the costing policy.
 *
 * A template's `pricing.overheadPct` becomes nullable: null means "use the
 * shop rate". Every existing template keeps the percentage it was priced on,
 * so templates with no overhead key at all are pinned to 0 here rather than
 * silently starting to follow the shop rate.
 */
export class ShopOverheadRate1792470000000 implements MigrationInterface {
  name = 'ShopOverheadRate1792470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "costing_policies"
        ADD "default_overhead_pct" numeric(5,4) NOT NULL DEFAULT '0',
        ADD "default_overhead_source" character varying(10),
        ADD "default_overhead_set_at" TIMESTAMP WITH TIME ZONE,
        ADD "default_overhead_basis" jsonb,
        ADD "overhead_suggestion_hidden" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "costing_policies"
        ADD CONSTRAINT "chk_costing_policies_default_overhead_pct"
          CHECK ("default_overhead_pct" >= 0 AND "default_overhead_pct" <= 1),
        ADD CONSTRAINT "chk_costing_policies_default_overhead_source"
          CHECK ("default_overhead_source" IS NULL OR "default_overhead_source" IN ('BOOKS', 'TYPED'))
    `);
    await queryRunner.query(`
      UPDATE "product_templates"
         SET "pricing" = jsonb_set("pricing", '{overheadPct}', '0'::jsonb, true)
       WHERE "pricing" IS NOT NULL
         AND jsonb_typeof("pricing") = 'object'
         AND ("pricing"->'overheadPct' IS NULL OR jsonb_typeof("pricing"->'overheadPct') = 'null')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Templates already following the shop rate fall back to no overhead.
    await queryRunner.query(`
      UPDATE "product_templates"
         SET "pricing" = jsonb_set("pricing", '{overheadPct}', '0'::jsonb, true)
       WHERE jsonb_typeof("pricing"->'overheadPct') = 'null'
    `);
    await queryRunner.query(`
      ALTER TABLE "costing_policies"
        DROP CONSTRAINT "chk_costing_policies_default_overhead_source",
        DROP CONSTRAINT "chk_costing_policies_default_overhead_pct",
        DROP COLUMN "overhead_suggestion_hidden",
        DROP COLUMN "default_overhead_basis",
        DROP COLUMN "default_overhead_set_at",
        DROP COLUMN "default_overhead_source",
        DROP COLUMN "default_overhead_pct"
    `);
  }
}
