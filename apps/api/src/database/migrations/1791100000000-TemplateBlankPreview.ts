import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Which flat blank the quote configurator draws for a template.
 *
 * It used to draw a rigid-box net for any template with length, width and
 * height parameters, which is wrong for a sign or a cabinet. Now only
 * templates that say so get one. Existing templates with all three
 * parameters keep their drawing, so nothing changes for them until someone
 * turns it off in the editor.
 */
export class TemplateBlankPreview1791100000000 implements MigrationInterface {
  name = 'TemplateBlankPreview1791100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "product_templates" ADD COLUMN "blank_preview" character varying(20)`,
    );
    await queryRunner.query(
      `UPDATE "product_templates" SET "blank_preview" = 'RIGID_BOX'
       WHERE "parameters" @> '[{"key":"length_mm"}]'
         AND "parameters" @> '[{"key":"width_mm"}]'
         AND "parameters" @> '[{"key":"height_mm"}]'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "product_templates" DROP COLUMN "blank_preview"`,
    );
  }
}
