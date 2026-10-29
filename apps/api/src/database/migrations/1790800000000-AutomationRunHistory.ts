import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Run history and the approvals inbox. A run records what started it
 * (`triggerSource`), and each approval it asks for becomes a row in
 * `automation_approvals` so one inbox can list and decide them.
 *
 * The app role needs no explicit grant: `scripts/create-db-app-role.sql` sets
 * default privileges for tables the admin role creates.
 */
export class AutomationRunHistory1790800000000 implements MigrationInterface {
  name = 'AutomationRunHistory1790800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The new value cannot be used until this transaction commits; the
    // follow-up migration does that.
    await queryRunner.query(
      `ALTER TYPE "automation_executions_status_enum" ADD VALUE IF NOT EXISTS 'UNKNOWN'`,
    );
    await queryRunner.query(
      `ALTER TABLE "automation_executions" ADD COLUMN IF NOT EXISTS "triggerSource" character varying(20)`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "automation_approvals" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenantId" uuid NOT NULL,
        "executionId" uuid NOT NULL,
        "workflowId" uuid NOT NULL,
        "nodeId" character varying(150) NOT NULL,
        "kind" character varying(20) NOT NULL,
        "title" character varying(255) NOT NULL,
        "details" jsonb NOT NULL DEFAULT '{}',
        "status" character varying(20) NOT NULL DEFAULT 'PENDING',
        "requestedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "expiresAt" TIMESTAMP WITH TIME ZONE,
        "decidedByUserId" uuid,
        "decidedAt" TIMESTAMP WITH TIME ZONE,
        "comment" text,
        CONSTRAINT "PK_automation_approvals_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_automation_approvals_execution_id" FOREIGN KEY ("executionId") REFERENCES "automation_executions"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_automation_approvals_tenant_status_requested" ON "automation_approvals" ("tenantId", "status", "requestedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_automation_approvals_execution_id" ON "automation_approvals" ("executionId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_automation_approvals_pending_node" ON "automation_approvals" ("executionId", "nodeId") WHERE status = 'PENDING'`,
    );

    const table = 'automation_approvals';
    await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);
    await queryRunner.query(
      `DROP POLICY IF EXISTS tenant_isolation_policy ON "${table}";`,
    );
    await queryRunner.query(
      `CREATE POLICY tenant_isolation_policy ON "${table}" FOR ALL ` +
        `USING (current_setting('app.bypass_rls', true) = 'on' OR "tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
        `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS tenant_isolation_policy ON "automation_approvals"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_approvals"`);
    await queryRunner.query(
      `ALTER TABLE "automation_executions" DROP COLUMN IF EXISTS "triggerSource"`,
    );
    // The 'UNKNOWN' enum value stays: Postgres cannot drop a value from an enum.
  }
}
