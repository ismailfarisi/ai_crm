import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-tenant purchasing limits. S2 band, after the purchasing tables.
 *
 * No row is seeded: absence means "not configured", and the service falls
 * back to `DEFAULT_PURCHASE_POLICY` with `enforce: false`. Seeding an
 * enforcing row here would block orders the moment this deploys.
 */
export class CreatePurchasePolicies1786410000000 implements MigrationInterface {
  name = 'CreatePurchasePolicies1786410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "purchase_policies" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "approval_threshold" numeric(12,2) NOT NULL DEFAULT '500',
        "require_preferred_supplier" boolean NOT NULL DEFAULT false,
        "variance_tolerance_pct" numeric(5,4) NOT NULL DEFAULT '0.05',
        "enforce" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_purchase_policies" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_purchase_policies_tenant" ON "purchase_policies" ("tenant_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchase_policies" ADD CONSTRAINT "FK_purchase_policies_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE`,
    );

    // Lifecycle timestamps on the order itself, so who did what is answerable
    // without joining the audit log.
    await queryRunner.query(`
      ALTER TABLE "purchase_orders"
        ADD COLUMN "submitted_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "submitted_by_id" uuid,
        ADD COLUMN "approved_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "approved_by_id" uuid,
        ADD COLUMN "sent_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "cancelled_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "cancelled_by_id" uuid,
        ADD COLUMN "cancel_reason" text,
        ADD COLUMN "source_quote_id" uuid
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "purchase_orders"
        DROP COLUMN "submitted_at",
        DROP COLUMN "submitted_by_id",
        DROP COLUMN "approved_at",
        DROP COLUMN "approved_by_id",
        DROP COLUMN "sent_at",
        DROP COLUMN "cancelled_at",
        DROP COLUMN "cancelled_by_id",
        DROP COLUMN "cancel_reason",
        DROP COLUMN "source_quote_id"
    `);
    await queryRunner.query(`DROP TABLE "purchase_policies"`);
  }
}
