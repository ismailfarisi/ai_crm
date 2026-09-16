import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The platform spine: the audit trail and file attachments. S0 band.
 *
 * Numbered into the S0 band although it ships last, because the band order is
 * what a fresh database replays and these two tables depend on nothing. On an
 * existing database TypeORM runs it as the next pending migration regardless
 * of its timestamp, which is the behaviour we want: the tables appear, and
 * nothing already posted is touched.
 *
 * Neither table is backfilled. An audit row invented for a change nobody
 * observed would be a lie in the one table that exists to be trusted, so the
 * trail starts the day it is deployed and says nothing about before.
 */
export class CreatePlatformSpine1786200000000 implements MigrationInterface {
  name = 'CreatePlatformSpine1786200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    /* ---------------- audit trail ---------------- */
    // Append-only: no updated_at, no deleted_at, and no service method that
    // writes either. The actor's name is denormalised so a row stays readable
    // after the user is deleted.
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "actor_id" uuid,
        "actor_name" character varying(180),
        "action" character varying(80) NOT NULL,
        "subject_type" character varying(40) NOT NULL,
        "subject_id" uuid,
        "summary" character varying(200),
        "changed_fields" jsonb,
        "before" jsonb,
        "after" jsonb,
        "ip" character varying(64),
        "origin" character varying(20) NOT NULL DEFAULT 'HUMAN',
        "origin_channel" character varying(20) NOT NULL DEFAULT 'WEB',
        "origin_message_id" character varying(255),
        "model" character varying(120),
        "prompt_version" character varying(40),
        "confidence" numeric(4,3),
        CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_subject" ON "audit_logs" ("tenant_id", "subject_type", "subject_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_tenant_created" ON "audit_logs" ("tenant_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_actor" ON "audit_logs" ("tenant_id", "actor_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_audit_logs_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE`,
    );
    // The actor link is deliberately ON DELETE SET NULL, not CASCADE: deleting
    // a user must not delete the evidence of what they did.
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_audit_logs_actor" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    );

    /* ---------------- attachments ---------------- */
    await queryRunner.query(`
      CREATE TABLE "attachments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "tenant_id" uuid NOT NULL,
        "owner_type" character varying(30) NOT NULL,
        "owner_id" uuid NOT NULL,
        "filename" character varying(255) NOT NULL,
        "content_type" character varying(120) NOT NULL,
        "size_bytes" bigint NOT NULL,
        "storage_key" character varying(500) NOT NULL,
        "checksum" character varying(64),
        "uploaded_by_id" uuid,
        CONSTRAINT "PK_attachments" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_attachments_owner" ON "attachments" ("tenant_id", "owner_type", "owner_id") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "attachments" ADD CONSTRAINT "FK_attachments_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "attachments" ADD CONSTRAINT "FK_attachments_uploader" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "attachments"`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
  }
}
