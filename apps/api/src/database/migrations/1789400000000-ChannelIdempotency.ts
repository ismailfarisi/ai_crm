import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes inbound channel processing idempotent.
 *
 * `channel_messages.externalMessageId` holds the provider's own id for an
 * inbound message, under a partial unique index scoped to (organization,
 * provider, sender) — Telegram's message_id is only unique within a chat. A
 * provider redelivering a webhook then fails to insert a second row, and the
 * service stops before running a staff command or an AI workflow again.
 *
 * Existing rows are backfilled from `metadata->>'externalId'`. Redeliveries
 * that already happened left duplicates behind; only the earliest row of each
 * group gets the id, the rest keep NULL (outside the partial index). Nothing
 * is deleted.
 *
 * `channel_idempotency_records` holds at-most-once claims for side effects
 * inside retried Temporal activities (`ChannelIdempotencyService`), unique on
 * (tenant_id, key), tenant-isolated by RLS like every other tenant table.
 */
export class ChannelIdempotency1789400000000 implements MigrationInterface {
  name = 'ChannelIdempotency1789400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // channel_messages has FORCE ROW LEVEL SECURITY; the backfill must see
    // every tenant's rows. Transaction-local, so it ends with the migration.
    await queryRunner.query(
      `SELECT set_config('app.bypass_rls', 'on', true)`,
    );

    await queryRunner.query(
      `ALTER TABLE "channel_messages" ADD COLUMN IF NOT EXISTS "externalMessageId" character varying(255)`,
    );

    await queryRunner.query(`
      UPDATE "channel_messages" m
         SET "externalMessageId" = LEFT(m."metadata"->>'externalId', 255)
        FROM (
          SELECT DISTINCT ON ("organizationId", "provider", "sender", LEFT("metadata"->>'externalId', 255))
                 "id"
            FROM "channel_messages"
           WHERE "direction" = 'INBOUND'
             AND COALESCE("metadata"->>'externalId', '') <> ''
           ORDER BY "organizationId", "provider", "sender", LEFT("metadata"->>'externalId', 255), "createdAt", "id"
        ) first_seen
       WHERE m."id" = first_seen."id"
         AND m."externalMessageId" IS NULL
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_channel_messages_inbound_external_id" ` +
        `ON "channel_messages" ("organizationId", "provider", "sender", "externalMessageId") ` +
        `WHERE "externalMessageId" IS NOT NULL`,
    );

    // At-most-once guard for side effects in retried Temporal activities
    // (drafting a quote from an inbound message, executing an agent tool).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "channel_idempotency_records" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "key" character varying(200) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'STARTED',
        "result" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_channel_idempotency_records_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_channel_idempotency_records_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_channel_idempotency_records_status" CHECK ("status" IN ('STARTED', 'COMPLETED'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_channel_idempotency_records_tenant_key" ON "channel_idempotency_records" ("tenant_id", "key")`,
    );

    await queryRunner.query(
      `ALTER TABLE "channel_idempotency_records" ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_idempotency_records" FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS tenant_isolation_policy ON "channel_idempotency_records"`,
    );
    await queryRunner.query(
      `CREATE POLICY tenant_isolation_policy ON "channel_idempotency_records" FOR ALL ` +
        `USING (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
        `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "channel_idempotency_records"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_channel_messages_inbound_external_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_messages" DROP COLUMN IF EXISTS "externalMessageId"`,
    );
  }
}
