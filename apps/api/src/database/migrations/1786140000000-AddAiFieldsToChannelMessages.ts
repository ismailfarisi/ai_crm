import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiFieldsToChannelMessages1786140000000
  implements MigrationInterface
{
  name = 'AddAiFieldsToChannelMessages1786140000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "public"."channel_messages_ai_intent_enum" AS ENUM('GENERAL_QUESTION', 'QUOTATION_REQUEST', 'ORDER_STATUS', 'PRICING_QUESTION', 'COMPLAINT', 'SUPPORT_REQUEST', 'SCHEDULING', 'SPAM', 'OTHER');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "public"."channel_messages_ai_processing_status_enum" AS ENUM('NONE', 'PENDING', 'COMPLETED', 'FAILED', 'SKIPPED');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );

    await queryRunner.query(
      `ALTER TABLE "channel_messages" ADD COLUMN IF NOT EXISTS "aiIntent" "public"."channel_messages_ai_intent_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_messages" ADD COLUMN IF NOT EXISTS "aiConfidence" real`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_messages" ADD COLUMN IF NOT EXISTS "aiSummary" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_messages" ADD COLUMN IF NOT EXISTS "aiSuggestedReply" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_messages" ADD COLUMN IF NOT EXISTS "aiSuggestedReplyOptions" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_messages" ADD COLUMN IF NOT EXISTS "aiProcessingStatus" "public"."channel_messages_ai_processing_status_enum" NOT NULL DEFAULT 'NONE'`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_messages" ADD COLUMN IF NOT EXISTS "aiAutoAcked" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_messages" ADD COLUMN IF NOT EXISTS "aiCreatedQuoteId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "channel_messages" DROP COLUMN "aiCreatedQuoteId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_messages" DROP COLUMN "aiAutoAcked"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_messages" DROP COLUMN "aiProcessingStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_messages" DROP COLUMN "aiSuggestedReplyOptions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_messages" DROP COLUMN "aiSuggestedReply"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_messages" DROP COLUMN "aiSummary"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_messages" DROP COLUMN "aiConfidence"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_messages" DROP COLUMN "aiIntent"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."channel_messages_ai_processing_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."channel_messages_ai_intent_enum"`,
    );
  }
}
