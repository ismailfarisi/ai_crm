import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDocumentTemplates1786130000000 implements MigrationInterface {
  name = 'CreateDocumentTemplates1786130000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "document_templates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "description" text,
        "is_default" boolean NOT NULL DEFAULT false,
        "applies_to" text[] NOT NULL DEFAULT '{}',
        "config" jsonb NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by_id" uuid,
        CONSTRAINT "PK_document_templates_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_document_templates_org" ON "document_templates" ("organization_id")`,
    );

    await queryRunner.query(
      `DO $$ BEGIN
        ALTER TABLE "document_templates" ADD CONSTRAINT "FK_document_templates_organization_id" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "document_templates" DROP CONSTRAINT IF EXISTS "FK_document_templates_organization_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_document_templates_org"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "document_templates"`);
  }
}
