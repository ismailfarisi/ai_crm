import { MigrationInterface, QueryRunner } from 'typeorm';

const TENANT_POLICY = (column: string) =>
  `CREATE POLICY tenant_isolation_policy ON "%TABLE%" FOR ALL ` +
  `USING (current_setting('app.bypass_rls', true) = 'on' OR ${column} = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
  `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR ${column} = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`;

export class EmailClient1791800000000 implements MigrationInterface {
  name = 'EmailClient1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "public"."email_accounts_providertype_enum" AS ENUM('GMAIL_OAUTH');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "public"."email_accounts_syncstatus_enum" AS ENUM('ACTIVE', 'ERROR', 'PAUSED');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "public"."email_threads_folder_enum" AS ENUM('INBOX', 'SENT', 'DRAFTS', 'ARCHIVE', 'SPAM', 'TRASH');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "public"."email_messages_direction_enum" AS ENUM('INBOUND', 'OUTBOUND');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "public"."email_messages_status_enum" AS ENUM('DRAFT', 'SENT', 'RECEIVED');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "email_accounts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "tenant_id" uuid NOT NULL, "userId" uuid NOT NULL, "emailAddress" character varying(255) NOT NULL, "name" character varying(255) NOT NULL DEFAULT '', "providerType" "public"."email_accounts_providertype_enum" NOT NULL DEFAULT 'GMAIL_OAUTH', "encryptedCredentials" text, "historyId" character varying(64), "isShared" boolean NOT NULL DEFAULT false, "syncStatus" "public"."email_accounts_syncstatus_enum" NOT NULL DEFAULT 'ACTIVE', "syncError" character varying(500), "lastSyncedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_email_accounts_tenant_user_address" UNIQUE ("tenant_id", "userId", "emailAddress"), CONSTRAINT "PK_email_accounts" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_email_accounts_tenant" ON "email_accounts" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_email_accounts_user" ON "email_accounts" ("userId")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "email_threads" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "tenant_id" uuid NOT NULL, "emailAccountId" uuid NOT NULL, "gmailThreadId" character varying(64) NOT NULL, "contactId" uuid, "subject" character varying(500) NOT NULL DEFAULT '', "snippet" text NOT NULL DEFAULT '', "folder" "public"."email_threads_folder_enum" NOT NULL DEFAULT 'INBOX', "isRead" boolean NOT NULL DEFAULT true, "isStarred" boolean NOT NULL DEFAULT false, "participants" jsonb NOT NULL DEFAULT '[]', "lastMessageAt" TIMESTAMP WITH TIME ZONE NOT NULL, "messageCount" integer NOT NULL DEFAULT 0, CONSTRAINT "UQ_email_threads_account_thread" UNIQUE ("emailAccountId", "gmailThreadId"), CONSTRAINT "PK_email_threads" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_email_threads_tenant_folder" ON "email_threads" ("tenant_id", "folder")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_email_threads_tenant_last_message" ON "email_threads" ("tenant_id", "lastMessageAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_email_threads_account" ON "email_threads" ("emailAccountId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_email_threads_contact" ON "email_threads" ("contactId")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "email_messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "tenant_id" uuid NOT NULL, "threadId" uuid NOT NULL, "emailAccountId" uuid NOT NULL, "gmailMessageId" character varying(64) NOT NULL, "messageIdHeader" character varying(500), "inReplyToHeader" character varying(500), "direction" "public"."email_messages_direction_enum" NOT NULL, "fromEmail" character varying(255) NOT NULL, "fromName" character varying(255), "toEmails" jsonb NOT NULL DEFAULT '[]', "ccEmails" jsonb NOT NULL DEFAULT '[]', "bccEmails" jsonb NOT NULL DEFAULT '[]', "subject" character varying(500) NOT NULL DEFAULT '', "bodyText" text NOT NULL DEFAULT '', "bodyHtml" text NOT NULL DEFAULT '', "labelIds" jsonb NOT NULL DEFAULT '[]', "hasAttachments" boolean NOT NULL DEFAULT false, "status" "public"."email_messages_status_enum" NOT NULL, "sentAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "UQ_email_messages_account_message" UNIQUE ("emailAccountId", "gmailMessageId"), CONSTRAINT "PK_email_messages" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_email_messages_tenant_thread" ON "email_messages" ("tenant_id", "threadId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_email_messages_account" ON "email_messages" ("emailAccountId")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "email_attachments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "tenant_id" uuid NOT NULL, "emailMessageId" uuid NOT NULL, "gmailAttachmentId" character varying(500) NOT NULL, "filename" character varying(255) NOT NULL, "mimeType" character varying(100) NOT NULL, "sizeBytes" integer NOT NULL DEFAULT 0, CONSTRAINT "UQ_email_attachments_message_attachment" UNIQUE ("emailMessageId", "gmailAttachmentId"), CONSTRAINT "PK_email_attachments" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_email_attachments_message" ON "email_attachments" ("emailMessageId")`,
    );

    await queryRunner.query(
      `DO $$ BEGIN
        ALTER TABLE "email_threads" ADD CONSTRAINT "FK_email_threads_account" FOREIGN KEY ("emailAccountId") REFERENCES "email_accounts"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        ALTER TABLE "email_threads" ADD CONSTRAINT "FK_email_threads_contact" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        ALTER TABLE "email_messages" ADD CONSTRAINT "FK_email_messages_thread" FOREIGN KEY ("threadId") REFERENCES "email_threads"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        ALTER TABLE "email_attachments" ADD CONSTRAINT "FK_email_attachments_message" FOREIGN KEY ("emailMessageId") REFERENCES "email_messages"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );

    for (const table of [
      'email_accounts',
      'email_threads',
      'email_messages',
      'email_attachments',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`,
      );
      await queryRunner.query(
        `DROP POLICY IF EXISTS tenant_isolation_policy ON "${table}";`,
      );
      await queryRunner.query(
        TENANT_POLICY('"tenant_id"').replace(/%TABLE%/g, table),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "email_attachments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "email_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "email_threads"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "email_accounts"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."email_messages_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."email_messages_direction_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."email_threads_folder_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."email_accounts_syncstatus_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."email_accounts_providertype_enum"`,
    );
  }
}
