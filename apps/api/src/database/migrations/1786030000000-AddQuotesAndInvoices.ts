import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddQuotesAndInvoices1786030000000 implements MigrationInterface {
  name = 'AddQuotesAndInvoices1786030000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "quotes_created_by_enum" AS ENUM('AI', 'HUMAN')`,
    );
    await queryRunner.query(
      `CREATE TYPE "quotes_status_enum" AS ENUM('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "invoices_status_enum" AS ENUM('ISSUED', 'PAID')`,
    );

    await queryRunner.query(
      `CREATE TABLE "quotes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "createdBy" "quotes_created_by_enum" NOT NULL DEFAULT 'HUMAN', "status" "quotes_status_enum" NOT NULL DEFAULT 'DRAFT', "title" character varying NOT NULL, "prompt" text, "items" jsonb NOT NULL DEFAULT '[]', "totalAmount" numeric(12,2) NOT NULL DEFAULT '0', "workflow_id" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_quotes_id" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE TABLE "invoices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "quote_id" uuid NOT NULL, "tenant_id" uuid NOT NULL, "invoice_number" character varying NOT NULL, "amount" numeric(12,2) NOT NULL, "status" "invoices_status_enum" NOT NULL DEFAULT 'ISSUED', "issued_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_invoices_id" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE INDEX "idx_quotes_tenant_id" ON "quotes" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_invoices_tenant_id" ON "invoices" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_invoices_quote_id" ON "invoices" ("quote_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "quotes" ADD CONSTRAINT "FK_quotes_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "FK_invoices_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "FK_invoices_quote_id" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "FK_invoices_quote_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "FK_invoices_tenant_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "quotes" DROP CONSTRAINT "FK_quotes_tenant_id"`,
    );

    await queryRunner.query(`DROP INDEX "idx_invoices_quote_id"`);
    await queryRunner.query(`DROP INDEX "idx_invoices_tenant_id"`);
    await queryRunner.query(`DROP INDEX "idx_quotes_tenant_id"`);

    await queryRunner.query(`DROP TABLE "invoices"`);
    await queryRunner.query(`DROP TABLE "quotes"`);

    await queryRunner.query(`DROP TYPE "invoices_status_enum"`);
    await queryRunner.query(`DROP TYPE "quotes_status_enum"`);
    await queryRunner.query(`DROP TYPE "quotes_created_by_enum"`);
  }
}
