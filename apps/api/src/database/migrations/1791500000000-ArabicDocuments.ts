import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Arabic and bilingual customer documents.
 *
 * The Arabic names, addresses and descriptions are optional: a document
 * without one prints the English value. A customer's document language is null
 * until chosen, which means "use the template's". Templates keep their language
 * in their JSON config, so they need no column.
 */
export class ArabicDocuments1791500000000 implements MigrationInterface {
  name = 'ArabicDocuments1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "organizations" ADD COLUMN "legal_name_ar" character varying(200), ADD COLUMN "address_ar" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers" ADD COLUMN "companyNameAr" character varying(120), ADD COLUMN "addressAr" character varying(500), ADD COLUMN "documentLanguage" character varying(16)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers" ADD CONSTRAINT "chk_customers_document_language" CHECK ("documentLanguage" IS NULL OR "documentLanguage" IN ('en', 'ar', 'bilingual'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalog_items" ADD COLUMN "description_ar" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "catalog_items" DROP COLUMN "description_ar"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers" DROP CONSTRAINT "chk_customers_document_language"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers" DROP COLUMN "documentLanguage", DROP COLUMN "addressAr", DROP COLUMN "companyNameAr"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN "address_ar", DROP COLUMN "legal_name_ar"`,
    );
  }
}
