import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProductionBoardSettings1787700000000 implements MigrationInterface {
  name = 'CreateProductionBoardSettings1787700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "production_board_settings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "columns" jsonb NOT NULL DEFAULT '[]',
        CONSTRAINT "PK_production_board_settings" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_production_board_settings_tenant" UNIQUE ("tenant_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_production_board_settings_tenant" ON "production_board_settings" ("tenant_id")
    `);
    await queryRunner.query(
      `ALTER TABLE "production_board_settings" ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE "production_board_settings" FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `CREATE POLICY tenant_isolation_policy ON "production_board_settings" FOR ALL ` +
        `USING (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
        `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "production_board_settings"`);
  }
}
