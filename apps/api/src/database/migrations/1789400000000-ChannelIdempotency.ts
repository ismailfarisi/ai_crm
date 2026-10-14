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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_channel_messages_inbound_external_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_messages" DROP COLUMN IF EXISTS "externalMessageId"`,
    );
  }
}
