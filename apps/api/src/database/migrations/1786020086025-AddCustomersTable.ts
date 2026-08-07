import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomersTable1786020086025 implements MigrationInterface {
  name = 'AddCustomersTable1786020086025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "customers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "organizationId" uuid NOT NULL, "companyName" character varying(120) NOT NULL, "contactName" character varying(120), "email" character varying(255), "phone" character varying(40), "addressLine1" character varying(160), "addressLine2" character varying(160), "city" character varying(80), "postalCode" character varying(20), "country" character varying(80), "taxId" character varying(40), "currency" character(3), "paymentTermsDays" integer, "notes" text, CONSTRAINT "PK_133ec679a801fab5e070f73d3ea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_customers_org_company" ON "customers"  ("organizationId", "companyName") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_customers_org_created" ON "customers"  ("organizationId", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "customers" ADD CONSTRAINT "FK_fac3145c49520eae6248715b26b" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "customers" DROP CONSTRAINT "FK_fac3145c49520eae6248715b26b"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_customers_org_created"`);
    await queryRunner.query(`DROP INDEX "public"."uq_customers_org_company"`);
    await queryRunner.query(`DROP TABLE "customers"`);
  }
}
