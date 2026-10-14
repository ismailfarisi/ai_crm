import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Durable delivery for CRM domain events and failed audit writes.
 *
 * Rows are written by `EventOutboxService.enqueue` and drained by its
 * dispatcher with `FOR UPDATE SKIP LOCKED`. `id` is the stable event id
 * subscribers dedupe on. `available_at` doubles as the claim lease and the
 * retry backoff; `attempts` and `last_error` record what happened, and a row
 * that runs out of attempts is parked as DEAD rather than deleted.
 *
 * No entity: the service talks to the table in SQL, so there is nothing for
 * the drift check to compare against.
 */
export class CreateCrmEventOutbox1789600000000 implements MigrationInterface {
  name = 'CreateCrmEventOutbox1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crm_event_outbox" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "kind" character varying(20) NOT NULL,
        "event_type" character varying(80) NOT NULL,
        "payload" jsonb NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'PENDING',
        "attempts" integer NOT NULL DEFAULT 0,
        "available_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "last_error" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "delivered_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_crm_event_outbox_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_crm_event_outbox_status" CHECK ("status" IN ('PENDING', 'DELIVERED', 'DEAD'))
      );
      CREATE INDEX IF NOT EXISTS "idx_crm_event_outbox_pending"
        ON "crm_event_outbox" ("available_at", "created_at")
        WHERE "status" = 'PENDING';
      CREATE INDEX IF NOT EXISTS "idx_crm_event_outbox_tenant_status"
        ON "crm_event_outbox" ("tenant_id", "status", "created_at");
    `);

    await queryRunner.query(
      `ALTER TABLE "crm_event_outbox" ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE "crm_event_outbox" FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `CREATE POLICY tenant_isolation_policy ON "crm_event_outbox" FOR ALL ` +
        `USING (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
        `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS tenant_isolation_policy ON "crm_event_outbox"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "crm_event_outbox"`);
  }
}
