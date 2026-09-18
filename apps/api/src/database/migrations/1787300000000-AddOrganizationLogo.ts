import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives an organization a logo to print on its documents.
 *
 * The company profile added an address, a tax registration and a footer, but
 * documents stayed text-only: there was no image upload anywhere, so the first
 * thing a customer notices about the paperwork they receive was the one thing
 * that could not be set.
 *
 * Stored on the row as bytes rather than in the attachment store, because this
 * is the one stored file served *inline* to someone with no session — a
 * customer opening a quote link. Attachments are deliberately served as
 * short-lived signed downloads with `Content-Disposition: attachment`, which
 * is exactly wrong for something that has to render in a letterhead.
 *
 * A logo is small and singular: one row, at most 2 MB, read on the documents
 * of the tenant that owns it. `bytea` keeps it inside the same backup and the
 * same tenant-delete cascade as everything else about the organization, with
 * no second store to keep in step.
 */
export class AddOrganizationLogo1787300000000 implements MigrationInterface {
  name = 'AddOrganizationLogo1787300000000';

  private static readonly COLUMNS: [string, string][] = [
    ['logo_data', 'bytea'],
    ['logo_content_type', 'character varying(40)'],
    ['logo_updated_at', 'TIMESTAMP WITH TIME ZONE'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [column, type] of AddOrganizationLogo1787300000000.COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "${column}" ${type}`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [column] of [...AddOrganizationLogo1787300000000.COLUMNS].reverse()) {
      await queryRunner.query(
        `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "${column}"`,
      );
    }
  }
}
