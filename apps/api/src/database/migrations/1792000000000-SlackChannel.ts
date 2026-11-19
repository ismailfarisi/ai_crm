import { MigrationInterface, QueryRunner } from 'typeorm';

export class SlackChannel1792000000000 implements MigrationInterface {
  name = 'SlackChannel1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const enumType of [
      'channel_configs_provider_enum',
      'channel_messages_provider_enum',
      'channel_conversations_provider_enum',
      'staff_channel_identities_provider_enum',
    ]) {
      await queryRunner.query(
        `ALTER TYPE "public"."${enumType}" ADD VALUE IF NOT EXISTS 'SLACK'`,
      );
    }
  }

  public async down(): Promise<void> {
    // Postgres cannot drop a single enum value; the value is inert when unused.
  }
}
