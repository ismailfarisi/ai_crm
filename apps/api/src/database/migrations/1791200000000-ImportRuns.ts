import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spreadsheet imports.
 *
 * One row per import, with its counts and the rejected rows for the error
 * file. The imported records themselves land in their own tables; this is
 * what the audit trail points at, so an import of 2,000 customers is one
 * audit entry rather than 2,000.
 */
export class ImportRuns1791200000000 implements MigrationInterface {
  name = 'ImportRuns1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "import_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "entity" character varying(40) NOT NULL,
        "file_name" character varying(255) NOT NULL,
        "on_duplicate" character varying(10) NOT NULL,
        "total_rows" integer NOT NULL DEFAULT '0',
        "created" integer NOT NULL DEFAULT '0',
        "updated" integer NOT NULL DEFAULT '0',
        "skipped" integer NOT NULL DEFAULT '0',
        "failed" integer NOT NULL DEFAULT '0',
        "failures" jsonb NOT NULL DEFAULT '[]',
        "created_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_import_runs_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_import_runs_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_import_runs_created_by" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_import_runs_tenant_created" ON "import_runs" ("tenant_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "import_runs" ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE "import_runs" FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `CREATE POLICY tenant_isolation_policy ON "import_runs" FOR ALL ` +
        `USING (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
        `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "import_runs"`);
  }
}
