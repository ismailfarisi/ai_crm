import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives an organization the details that belong on the documents it sends.
 *
 * `organizations` held a name, a slug and a base currency, and nothing else —
 * no controller existed for it either, so `org:read` and `org:update` were
 * granted to the owner and governed nothing. A quote reached a customer headed
 * by the trading name alone, with no address, no registration number and no
 * tax id, which most jurisdictions require on an invoice and which no screen
 * could supply.
 *
 * Every column is nullable. Existing tenants keep working unchanged and fill
 * these in when they get to the new Company screen; nothing reads them without
 * checking first.
 *
 * `country` is two characters because tax rules match on an ISO 3166-1 alpha-2
 * code (`taxRuleFor` matches a country, then `EU`, then `*`). Storing
 * "United States" here would match nothing.
 */
export class AddOrganizationProfile1787100000000 implements MigrationInterface {
  name = 'AddOrganizationProfile1787100000000';

  /** column -> type, in the order they are added. */
  private static readonly COLUMNS: [string, string][] = [
    ['legal_name', 'character varying(200)'],
    ['tax_id', 'character varying(60)'],
    ['registration_number', 'character varying(60)'],
    ['email', 'character varying(160)'],
    ['phone', 'character varying(40)'],
    ['website', 'character varying(200)'],
    ['address_line1', 'character varying(200)'],
    ['address_line2', 'character varying(200)'],
    ['city', 'character varying(120)'],
    ['region', 'character varying(120)'],
    ['postal_code', 'character varying(30)'],
    ['country', 'character(2)'],
    ['document_footer', 'text'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [column, type] of AddOrganizationProfile1787100000000.COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "${column}" ${type}`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [column] of [
      ...AddOrganizationProfile1787100000000.COLUMNS,
    ].reverse()) {
      await queryRunner.query(
        `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "${column}"`,
      );
    }
  }
}
