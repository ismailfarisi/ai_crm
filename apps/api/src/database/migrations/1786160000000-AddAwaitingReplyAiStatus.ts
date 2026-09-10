import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAwaitingReplyAiStatus1786160000000 implements MigrationInterface {
  name = 'AddAwaitingReplyAiStatus1786160000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "channel_messages_ai_processing_status_enum" ADD VALUE IF NOT EXISTS 'AWAITING_REPLY'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres cannot drop a single enum value; no-op, same as the
    // AddInvoicePaymentsAndVoidSupport precedent for enum additions.
  }
}
