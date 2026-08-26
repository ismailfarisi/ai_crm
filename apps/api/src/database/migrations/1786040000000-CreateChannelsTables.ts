import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateChannelsTables1786040000000 implements MigrationInterface {
  name = 'CreateChannelsTables1786040000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."channel_configs_provider_enum" AS ENUM('WHATSAPP_META', 'TELEGRAM', 'EMAIL_SMTP', 'EMAIL_RESEND')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."channel_configs_status_enum" AS ENUM('unconfigured', 'configured', 'error')`,
    );
    await queryRunner.query(
      `CREATE TABLE "channel_configs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "provider" "public"."channel_configs_provider_enum" NOT NULL, "isEnabled" boolean NOT NULL DEFAULT false, "encryptedCredentials" text, "webhookSecret" character varying, "status" "public"."channel_configs_status_enum" NOT NULL DEFAULT 'unconfigured', "lastTestedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_73a7f617cfdc947848f63946914" UNIQUE ("organizationId", "provider"), CONSTRAINT "PK_71b592f5e0da6907fce0f0654cb" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_34a2381dd9a2d031c846866180" ON "channel_configs" ("organizationId")`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."channel_messages_provider_enum" AS ENUM('WHATSAPP_META', 'TELEGRAM', 'EMAIL_SMTP', 'EMAIL_RESEND')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."channel_messages_direction_enum" AS ENUM('INBOUND', 'OUTBOUND')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."channel_messages_status_enum" AS ENUM('pending', 'sent', 'delivered', 'failed', 'received')`,
    );
    await queryRunner.query(
      `CREATE TABLE "channel_messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "contactId" uuid, "provider" "public"."channel_messages_provider_enum" NOT NULL, "direction" "public"."channel_messages_direction_enum" NOT NULL, "sender" character varying(255) NOT NULL, "recipient" character varying(255) NOT NULL, "body" text NOT NULL, "metadata" jsonb NOT NULL DEFAULT '{}', "status" "public"."channel_messages_status_enum" NOT NULL DEFAULT 'pending', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_78c08df85633e14659b3bfcd3b7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e712c9cf18cd848fcb25e636aa" ON "channel_messages" ("organizationId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_98abb3aa56123f0fda49dcc2c6" ON "channel_messages" ("contactId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_694154ec27c6fe027e6fd66408" ON "channel_messages" ("createdAt")`,
    );

    await queryRunner.query(
      `ALTER TABLE "channel_messages" ADD CONSTRAINT "FK_98abb3aa56123f0fda49dcc2c6a" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "channel_messages" DROP CONSTRAINT "FK_98abb3aa56123f0fda49dcc2c6a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_694154ec27c6fe027e6fd66408"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_98abb3aa56123f0fda49dcc2c6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e712c9cf18cd848fcb25e636aa"`,
    );
    await queryRunner.query(`DROP TABLE "channel_messages"`);
    await queryRunner.query(
      `DROP TYPE "public"."channel_messages_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."channel_messages_direction_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."channel_messages_provider_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_34a2381dd9a2d031c846866180"`,
    );
    await queryRunner.query(`DROP TABLE "channel_configs"`);
    await queryRunner.query(`DROP TYPE "public"."channel_configs_status_enum"`);
    await queryRunner.query(
      `DROP TYPE "public"."channel_configs_provider_enum"`,
    );
  }
}
