import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Customers paying a tenant online (modules/payments).
 *
 * - `payment_settings`: one row per tenant: provider, its keys encrypted
 *   (never returned), the account payments are recorded into, the default
 *   deposit, and which documents get a Pay button.
 * - `payment_checkouts`: each hosted checkout started. Records no money; the
 *   provider's paid event does, through the invoice payment path.
 * - `payment_webhook_events`: provider event ids already handled, so a
 *   redelivered event records nothing twice.
 * - `invoice_pay_links`: the hashed token behind an invoice's public pay link.
 */
export class OnlinePayments1791400000000 implements MigrationInterface {
  name = 'OnlinePayments1791400000000';

  private readonly tables = [
    'payment_settings',
    'payment_checkouts',
    'payment_webhook_events',
    'invoice_pay_links',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "payment_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "tenant_id" uuid NOT NULL, "provider" character varying(20) NOT NULL DEFAULT 'NONE', "encrypted_credentials" text, "secret_key_hint" character varying(8), "webhook_key" character varying(64) NOT NULL, "finance_account_id" uuid, "default_deposit_percent" numeric(5,2) NOT NULL DEFAULT '0', "pay_deposits" boolean NOT NULL DEFAULT false, "pay_invoices" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_78624861ce2178d6835fb1d9fdf" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_payment_settings_webhook_key" ON "payment_settings"  ("webhook_key") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_payment_settings_tenant" ON "payment_settings"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "payment_checkouts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "tenant_id" uuid NOT NULL, "invoice_id" uuid NOT NULL, "purpose" character varying(20) NOT NULL, "provider" character varying(20) NOT NULL, "provider_session_id" character varying(255) NOT NULL, "amount" numeric(15,2) NOT NULL, "currency" character varying(10) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'OPEN', "invoice_payment_id" uuid, "completed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_e0078aadaa1cd1d5f7646510642" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_payment_checkouts_invoice" ON "payment_checkouts"  ("tenant_id", "invoice_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_payment_checkouts_session" ON "payment_checkouts"  ("provider", "provider_session_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "payment_webhook_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "tenant_id" uuid NOT NULL, "provider" character varying(20) NOT NULL, "event_id" character varying(255) NOT NULL, "type" character varying(100) NOT NULL, CONSTRAINT "PK_750875e71d97974be92cee813ba" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_payment_webhook_events_event" ON "payment_webhook_events"  ("tenant_id", "provider", "event_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "invoice_pay_links" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "tenant_id" uuid NOT NULL, "invoice_id" uuid NOT NULL, "token_hash" character varying(64) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_7b1a93c01a3ec83dd4ea05a1e48" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_invoice_pay_links_token" ON "invoice_pay_links"  ("token_hash") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_invoice_pay_links_invoice" ON "invoice_pay_links"  ("invoice_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_settings" ADD CONSTRAINT "FK_payment_settings_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_settings" ADD CONSTRAINT "FK_payment_settings_account" FOREIGN KEY ("finance_account_id") REFERENCES "finance_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_checkouts" ADD CONSTRAINT "FK_payment_checkouts_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_checkouts" ADD CONSTRAINT "FK_payment_checkouts_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_checkouts" ADD CONSTRAINT "FK_payment_checkouts_payment" FOREIGN KEY ("invoice_payment_id") REFERENCES "invoice_payments"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "FK_payment_webhook_events_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_pay_links" ADD CONSTRAINT "FK_invoice_pay_links_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_pay_links" ADD CONSTRAINT "FK_invoice_pay_links_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    for (const table of this.tables) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(
        `CREATE POLICY tenant_isolation_policy ON "${table}" FOR ALL ` +
          `USING (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
          `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_invoice_pay_links_invoice"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_invoice_pay_links_token"`);
    await queryRunner.query(`DROP TABLE "invoice_pay_links"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_payment_webhook_events_event"`,
    );
    await queryRunner.query(`DROP TABLE "payment_webhook_events"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_payment_checkouts_session"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_payment_checkouts_invoice"`,
    );
    await queryRunner.query(`DROP TABLE "payment_checkouts"`);
    await queryRunner.query(`DROP INDEX "public"."uq_payment_settings_tenant"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_payment_settings_webhook_key"`,
    );
    await queryRunner.query(`DROP TABLE "payment_settings"`);
  }
}
