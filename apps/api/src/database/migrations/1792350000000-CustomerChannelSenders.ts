import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Senders staff have confirmed belong to a customer
 * (`customer_channel_senders`), so a customer agent can tell that customer,
 * and nobody else, where their orders and quotes stand.
 */
export class CustomerChannelSenders1792350000000 implements MigrationInterface {
  name = 'CustomerChannelSenders1792350000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "customer_channel_senders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "customerId" uuid NOT NULL, "provider" character varying(30) NOT NULL, "identifier" character varying(255) NOT NULL, "createdById" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_customer_channel_senders" PRIMARY KEY ("id"), CONSTRAINT "FK_customer_channel_senders_customer" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_customer_channel_senders_identifier" ON "customer_channel_senders" ("organizationId", "provider", "identifier")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_customer_channel_senders_customer" ON "customer_channel_senders" ("customerId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "customer_channel_senders" ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE "customer_channel_senders" FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS tenant_isolation_policy ON "customer_channel_senders"`,
    );
    await queryRunner.query(
      `CREATE POLICY tenant_isolation_policy ON "customer_channel_senders" FOR ALL ` +
        `USING (current_setting('app.bypass_rls', true) = 'on' OR "organizationId" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
        `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "organizationId" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_channel_senders"`);
  }
}
