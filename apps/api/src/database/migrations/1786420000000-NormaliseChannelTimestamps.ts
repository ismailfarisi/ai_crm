import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Converts the last eleven naive timestamp columns to `timestamptz`.
 *
 * Every table in the repository stores instants as `TIMESTAMP WITH TIME ZONE`
 * — `BaseEntity` sets that convention and nineteen entities follow it. Six
 * entities in the channels and AI modules never said so explicitly, so
 * TypeORM applied its Postgres default of `timestamp without time zone` and
 * the migrations that created those tables wrote naive columns.
 *
 * Two of the eleven (`intent_agent_configs.createdAt` and `.updatedAt`) were
 * genuine schema drift: that entity did declare `timestamptz` while its table
 * held naive values. The other nine were consistent with their entities and
 * inconsistent with everything else; this migration and the matching entity
 * changes bring both sides onto the convention together, so the fix does not
 * trade one drift for another.
 *
 * Harmless while every process runs in UTC, wrong the moment one does not:
 * a naive column is read back in the session time zone, so the same row can
 * report two different instants to two different connections.
 */
export class NormaliseChannelTimestamps1786420000000 implements MigrationInterface {
  name = 'NormaliseChannelTimestamps1786420000000';

  /** table -> columns, matching the six entities that omitted an explicit type. */
  private static readonly COLUMNS: [string, string[]][] = [
    ['ai_agents', ['createdAt', 'updatedAt']],
    ['ai_configs', ['createdAt', 'updatedAt']],
    ['channel_configs', ['createdAt', 'updatedAt']],
    ['channel_link_codes', ['createdAt']],
    ['channel_messages', ['createdAt']],
    ['intent_agent_configs', ['createdAt', 'updatedAt']],
    ['staff_channel_identities', ['createdAt']],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [
      table,
      columns,
    ] of NormaliseChannelTimestamps1786420000000.COLUMNS) {
      for (const column of columns) {
        // `AT TIME ZONE 'UTC'` is the load-bearing part. These values were
        // written by Node as UTC instants and stored without a zone; without
        // the USING clause Postgres would reinterpret them in the session
        // time zone and silently shift every row by the server's offset.
        await queryRunner.query(
          `ALTER TABLE "${table}"
             ALTER COLUMN "${column}" TYPE timestamptz
             USING "${column}" AT TIME ZONE 'UTC'`,
        );
        // The default was dropped to `now()` returning timestamp; restate it
        // so new rows keep defaulting after the type change.
        await queryRunner.query(
          `ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT now()`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [
      table,
      columns,
    ] of NormaliseChannelTimestamps1786420000000.COLUMNS) {
      for (const column of columns) {
        // Symmetrical: read the instant back out as UTC wall-clock time, which
        // is exactly what was stored before.
        await queryRunner.query(
          `ALTER TABLE "${table}"
             ALTER COLUMN "${column}" TYPE timestamp
             USING "${column}" AT TIME ZONE 'UTC'`,
        );
        await queryRunner.query(
          `ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT now()`,
        );
      }
    }
  }
}
