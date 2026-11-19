import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Generalises the email client beyond Gmail: provider id columns lose their
 * `gmail*` names, the sync cursor widens to hold a per-mailbox IMAP cursor
 * map, and the provider enum gains IMAP_SMTP for app-password connections.
 */
export class EmailImapProvider1791900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // PG12+ allows the new value within the same transaction; nothing below
    // writes IMAP_SMTP rows in this migration anyway.
    await queryRunner.query(
      `ALTER TYPE "public"."email_accounts_providertype_enum" ADD VALUE IF NOT EXISTS 'IMAP_SMTP'`,
    );

    await queryRunner.query(
      `ALTER TABLE "email_accounts" RENAME COLUMN "historyId" TO "syncCursor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_accounts" ALTER COLUMN "syncCursor" TYPE text`,
    );

    await queryRunner.query(
      `ALTER TABLE "email_threads" RENAME COLUMN "gmailThreadId" TO "providerThreadId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_threads" ALTER COLUMN "providerThreadId" TYPE character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_threads" RENAME CONSTRAINT "UQ_email_threads_account_thread" TO "UQ_email_threads_account_provider"`,
    );

    await queryRunner.query(
      `ALTER TABLE "email_messages" RENAME COLUMN "gmailMessageId" TO "providerMessageId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_messages" ALTER COLUMN "providerMessageId" TYPE character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_messages" RENAME CONSTRAINT "UQ_email_messages_account_message" TO "UQ_email_messages_account_provider"`,
    );

    await queryRunner.query(
      `ALTER TABLE "email_attachments" RENAME COLUMN "gmailAttachmentId" TO "providerAttachmentId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_attachments" RENAME CONSTRAINT "UQ_email_attachments_message_attachment" TO "UQ_email_attachments_message_provider"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Enum values cannot be removed — IMAP_SMTP stays in the type on rollback.
    await queryRunner.query(
      `ALTER TABLE "email_attachments" RENAME CONSTRAINT "UQ_email_attachments_message_provider" TO "UQ_email_attachments_message_attachment"`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_attachments" RENAME COLUMN "providerAttachmentId" TO "gmailAttachmentId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_messages" RENAME CONSTRAINT "UQ_email_messages_account_provider" TO "UQ_email_messages_account_message"`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_messages" ALTER COLUMN "providerMessageId" TYPE character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_messages" RENAME COLUMN "providerMessageId" TO "gmailMessageId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_threads" RENAME CONSTRAINT "UQ_email_threads_account_provider" TO "UQ_email_threads_account_thread"`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_threads" ALTER COLUMN "providerThreadId" TYPE character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_threads" RENAME COLUMN "providerThreadId" TO "gmailThreadId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_accounts" ALTER COLUMN "syncCursor" TYPE character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_accounts" RENAME COLUMN "syncCursor" TO "historyId"`,
    );
  }
}
