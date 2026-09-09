import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateChannelCommandTables1786120000000 implements MigrationInterface {
  name = 'CreateChannelCommandTables1786120000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "public"."staff_channel_identities_provider_enum" AS ENUM('WHATSAPP_META', 'TELEGRAM', 'EMAIL_SMTP', 'EMAIL_RESEND');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );
    await queryRunner.query(
      `CREATE TABLE "staff_channel_identities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "provider" "public"."staff_channel_identities_provider_enum" NOT NULL, "identifier" character varying(255) NOT NULL, "userId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_staff_channel_identities_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_staff_channel_identities_user_id" ON "staff_channel_identities" ("userId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_staff_channel_identities_org_provider_identifier" ON "staff_channel_identities" ("organizationId", "provider", "identifier")`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_channel_identities" ADD CONSTRAINT "FK_staff_channel_identities_organization_id" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_channel_identities" ADD CONSTRAINT "FK_staff_channel_identities_user_id" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TABLE "channel_link_codes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "userId" uuid NOT NULL, "code" character varying(8) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "consumedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_channel_link_codes_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_channel_link_codes_code" ON "channel_link_codes" ("code")`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_link_codes" ADD CONSTRAINT "FK_channel_link_codes_organization_id" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_link_codes" ADD CONSTRAINT "FK_channel_link_codes_user_id" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "public"."pending_channel_commands_provider_enum" AS ENUM('WHATSAPP_META', 'TELEGRAM', 'EMAIL_SMTP', 'EMAIL_RESEND');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."pending_channel_commands_action_enum" AS ENUM('APPROVE', 'APPROVE_AND_SEND')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."pending_channel_commands_status_enum" AS ENUM('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "pending_channel_commands" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "userId" uuid NOT NULL, "provider" "public"."pending_channel_commands_provider_enum" NOT NULL, "senderIdentifier" character varying(255) NOT NULL, "action" "public"."pending_channel_commands_action_enum" NOT NULL, "quoteId" uuid NOT NULL, "status" "public"."pending_channel_commands_status_enum" NOT NULL DEFAULT 'PENDING', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "resolvedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_pending_channel_commands_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pending_channel_commands_lookup" ON "pending_channel_commands" ("organizationId", "provider", "senderIdentifier", "status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "pending_channel_commands" ADD CONSTRAINT "FK_pending_channel_commands_organization_id" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "pending_channel_commands" ADD CONSTRAINT "FK_pending_channel_commands_user_id" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "pending_channel_commands" ADD CONSTRAINT "FK_pending_channel_commands_quote_id" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pending_channel_commands" DROP CONSTRAINT "FK_pending_channel_commands_quote_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pending_channel_commands" DROP CONSTRAINT "FK_pending_channel_commands_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pending_channel_commands" DROP CONSTRAINT "FK_pending_channel_commands_organization_id"`,
    );
    await queryRunner.query(`DROP INDEX "idx_pending_channel_commands_lookup"`);
    await queryRunner.query(`DROP TABLE "pending_channel_commands"`);
    await queryRunner.query(
      `DROP TYPE "public"."pending_channel_commands_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."pending_channel_commands_action_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."pending_channel_commands_provider_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "channel_link_codes" DROP CONSTRAINT "FK_channel_link_codes_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_link_codes" DROP CONSTRAINT "FK_channel_link_codes_organization_id"`,
    );
    await queryRunner.query(`DROP INDEX "idx_channel_link_codes_code"`);
    await queryRunner.query(`DROP TABLE "channel_link_codes"`);

    await queryRunner.query(
      `ALTER TABLE "staff_channel_identities" DROP CONSTRAINT "FK_staff_channel_identities_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_channel_identities" DROP CONSTRAINT "FK_staff_channel_identities_organization_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "uq_staff_channel_identities_org_provider_identifier"`,
    );
    await queryRunner.query(
      `DROP INDEX "idx_staff_channel_identities_user_id"`,
    );
    await queryRunner.query(`DROP TABLE "staff_channel_identities"`);
    await queryRunner.query(
      `DROP TYPE "public"."staff_channel_identities_provider_enum"`,
    );
  }
}
