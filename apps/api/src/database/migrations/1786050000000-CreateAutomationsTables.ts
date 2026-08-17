import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAutomationsTables1786050000000 implements MigrationInterface {
  name = 'CreateAutomationsTables1786050000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "automation_workflows_status_enum" AS ENUM('DRAFT', 'ACTIVE', 'PAUSED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "automation_workflows" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenantId" uuid NOT NULL,
        "name" character varying(255) NOT NULL,
        "description" text,
        "status" "automation_workflows_status_enum" NOT NULL DEFAULT 'DRAFT',
        "triggerType" character varying(50) NOT NULL DEFAULT 'MANUAL',
        "triggerConfig" jsonb NOT NULL DEFAULT '{}',
        "nodes" jsonb NOT NULL DEFAULT '[]',
        "edges" jsonb NOT NULL DEFAULT '[]',
        "webhookSlug" character varying(100),
        "version" integer NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_automation_workflows_webhook_slug" UNIQUE ("webhookSlug"),
        CONSTRAINT "PK_automation_workflows_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_automation_workflows_tenant_id" ON "automation_workflows" ("tenantId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "automation_workflows" ADD CONSTRAINT "FK_automation_workflows_tenant_id" FOREIGN KEY ("tenantId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TYPE "automation_executions_status_enum" AS ENUM('RUNNING', 'WAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "automation_executions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenantId" uuid NOT NULL,
        "workflowId" uuid NOT NULL,
        "temporalWorkflowId" character varying(150) NOT NULL,
        "status" "automation_executions_status_enum" NOT NULL DEFAULT 'RUNNING',
        "triggerPayload" jsonb NOT NULL DEFAULT '{}',
        "nodeResults" jsonb NOT NULL DEFAULT '{}',
        "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "finishedAt" TIMESTAMP WITH TIME ZONE,
        "errorMessage" text,
        CONSTRAINT "PK_automation_executions_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_automation_executions_tenant_id" ON "automation_executions" ("tenantId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_automation_executions_workflow_id" ON "automation_executions" ("workflowId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "automation_executions" ADD CONSTRAINT "FK_automation_executions_tenant_id" FOREIGN KEY ("tenantId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "automation_executions" ADD CONSTRAINT "FK_automation_executions_workflow_id" FOREIGN KEY ("workflowId") REFERENCES "automation_workflows"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "automation_executions" DROP CONSTRAINT "FK_automation_executions_workflow_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "automation_executions" DROP CONSTRAINT "FK_automation_executions_tenant_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_automation_executions_workflow_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_automation_executions_tenant_id"`,
    );
    await queryRunner.query(`DROP TABLE "automation_executions"`);
    await queryRunner.query(
      `DROP TYPE "public"."automation_executions_status_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "automation_workflows" DROP CONSTRAINT "FK_automation_workflows_tenant_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_automation_workflows_tenant_id"`,
    );
    await queryRunner.query(`DROP TABLE "automation_workflows"`);
    await queryRunner.query(
      `DROP TYPE "public"."automation_workflows_status_enum"`,
    );
  }
}
