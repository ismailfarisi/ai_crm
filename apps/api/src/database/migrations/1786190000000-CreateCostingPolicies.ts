import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2: the commercial floors a tenant sets on its own quoting.
 *
 * Every existing organization gets a row with `enforce = false`, so switching
 * the costing engine on changes nothing until someone deliberately turns the
 * guardrails on. Same approach as `intent_agent_configs`.
 */
export class CreateCostingPolicies1786190000000 implements MigrationInterface {
  name = 'CreateCostingPolicies1786190000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "costing_policies" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "min_margin_pct" numeric(5,4) NOT NULL DEFAULT '0.2',
        "max_discount_pct" numeric(5,2) NOT NULL DEFAULT '20',
        "require_known_cost" boolean NOT NULL DEFAULT false,
        "enforce" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_costing_policies_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_costing_policies_tenant" ON "costing_policies" ("tenant_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "costing_policies" ADD CONSTRAINT "FK_costing_policies_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `INSERT INTO "costing_policies" ("tenant_id") SELECT "id" FROM "organizations"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "costing_policies"`);
  }
}
