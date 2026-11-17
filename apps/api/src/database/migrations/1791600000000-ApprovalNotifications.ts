import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Approval notifications: one row per approval request (quote, automation
 * step, assistant action), one row per delivery (request + recipient +
 * event + channel, unique, so redelivery never double-sends) and the
 * per-user / organisation notification preferences.
 */
export class ApprovalNotifications1791600000000 implements MigrationInterface {
  name = 'ApprovalNotifications1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "approval_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "item_type" character varying(30) NOT NULL,
        "item_id" uuid NOT NULL,
        "requested_by_user_id" uuid,
        "permissions" text array NOT NULL DEFAULT '{}',
        "recipient_user_id" uuid,
        "title" character varying(200) NOT NULL,
        "body" text,
        "link" character varying(300),
        "meta" jsonb,
        "notify_now" boolean NOT NULL DEFAULT true,
        "requested_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "expires_at" TIMESTAMP WITH TIME ZONE,
        "remind_at" TIMESTAMP WITH TIME ZONE,
        "reminded_at" TIMESTAMP WITH TIME ZONE,
        "status" character varying(20) NOT NULL DEFAULT 'PENDING',
        "decided_by_user_id" uuid,
        "decided_at" TIMESTAMP WITH TIME ZONE,
        "comment" text,
        CONSTRAINT "PK_approval_requests_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_approval_requests_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_approval_requests_pending_item" ON "approval_requests" ("tenant_id", "item_type", "item_id") WHERE status = 'PENDING'`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_approval_requests_status_remind_at" ON "approval_requests" ("status", "remind_at")`,
    );

    await queryRunner.query(
      `CREATE TABLE "approval_deliveries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "request_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "event" character varying(20) NOT NULL,
        "channel" character varying(20) NOT NULL,
        "status" character varying(20) NOT NULL,
        "due_at" TIMESTAMP WITH TIME ZONE,
        "attempts" integer NOT NULL DEFAULT 0,
        "last_error" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "sent_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_approval_deliveries_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_approval_deliveries_request_id" FOREIGN KEY ("request_id") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_approval_deliveries_once" ON "approval_deliveries" ("request_id", "user_id", "event", "channel")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_approval_deliveries_status_due_at" ON "approval_deliveries" ("status", "due_at")`,
    );

    await queryRunner.query(
      `CREATE TABLE "notification_preferences" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid,
        "approval_channels" text array NOT NULL,
        "outcome_channels" text array NOT NULL,
        "quiet_hours_start" character varying(5),
        "quiet_hours_end" character varying(5),
        "timezone" character varying(60),
        "reminder_delay_minutes" integer,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_preferences_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_notification_preferences_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_notification_preferences_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_notification_preferences_user" ON "notification_preferences" ("tenant_id", "user_id") WHERE user_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_notification_preferences_org" ON "notification_preferences" ("tenant_id") WHERE user_id IS NULL`,
    );

    for (const table of [
      'approval_requests',
      'approval_deliveries',
      'notification_preferences',
    ]) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);
      await queryRunner.query(
        `DROP POLICY IF EXISTS tenant_isolation_policy ON "${table}";`,
      );
      await queryRunner.query(
        `CREATE POLICY tenant_isolation_policy ON "${table}" FOR ALL ` +
          `USING (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
          `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'notification_preferences',
      'approval_deliveries',
      'approval_requests',
    ]) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS tenant_isolation_policy ON "${table}"`,
      );
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }
}
