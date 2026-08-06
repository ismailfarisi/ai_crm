import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvitationsTable1785936535948 implements MigrationInterface {
  name = 'AddInvitationsTable1785936535948';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "invitations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organizationId" uuid NOT NULL, "email" character varying(255) NOT NULL, "firstName" character varying(80) NOT NULL, "lastName" character varying(80) NOT NULL, "roleIds" jsonb NOT NULL, "teamId" uuid, "tokenHash" character varying(64) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "invitedById" uuid NOT NULL, "acceptedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_5dec98cfdfd562e4ad3648bbb07" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_invitations_org" ON "invitations"  ("organizationId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_invitations_hash" ON "invitations"  ("tokenHash") `,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" ADD CONSTRAINT "FK_b9139f00cebfadced76bca3084f" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" ADD CONSTRAINT "FK_b60325e5302be0dad38b423314c" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invitations" DROP CONSTRAINT "FK_b60325e5302be0dad38b423314c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" DROP CONSTRAINT "FK_b9139f00cebfadced76bca3084f"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_invitations_hash"`);
    await queryRunner.query(`DROP INDEX "public"."idx_invitations_org"`);
    await queryRunner.query(`DROP TABLE "invitations"`);
  }
}
