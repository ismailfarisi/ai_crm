import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Multi-currency, subscription billing and notifications. S8 band.
 *
 * Currency data:
 * - each organization's base currency is the one most of its documents are
 *   in, so a tenant that has only ever traded in GBP gets GBP, not the USD
 *   column default;
 * - every existing document is stamped with a rate of 1. That is what the
 *   books have implicitly assumed all along; restating history at rates
 *   nobody recorded would be inventing numbers. Documents posted from now
 *   on carry their real rate.
 *
 * Billing data: existing organizations start a 30-day trial rather than being
 * restricted the moment this deploys.
 */
export class CurrencyBillingAndNotifications1787000000000 implements MigrationInterface {
  name = 'CurrencyBillingAndNotifications1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    /* ---------------- currency ---------------- */
    await queryRunner.query(
      `ALTER TABLE "organizations" ADD "base_currency" character(3) NOT NULL DEFAULT 'USD'`,
    );
    await queryRunner.query(`
      UPDATE "organizations" o SET "base_currency" = pick.currency
      FROM (
        SELECT DISTINCT ON (tenant_id) tenant_id, currency
        FROM (
          SELECT "tenant_id", "currency" FROM "invoices"
          UNION ALL SELECT "tenant_id", "currency" FROM "quotes"
          UNION ALL SELECT "tenant_id", "currency" FROM "supplier_bills"
          UNION ALL SELECT "tenant_id", "currency" FROM "purchase_orders"
        ) docs
        GROUP BY tenant_id, currency
        ORDER BY tenant_id, COUNT(*) DESC, currency
      ) pick
      WHERE pick.tenant_id = o."id"`);

    await queryRunner.query(`
      CREATE TABLE "fx_rates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "currency" character(3) NOT NULL,
        "rate_date" date NOT NULL,
        "rate" numeric(18,8) NOT NULL,
        "source" character varying(40),
        CONSTRAINT "PK_fx_rates" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_fx_rates_positive" CHECK ("rate" > 0)
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_fx_rates_tenant_currency_date" ON "fx_rates" ("tenant_id", "currency", "rate_date")`,
    );
    await queryRunner.query(
      `ALTER TABLE "fx_rates" ADD CONSTRAINT "FK_fx_rates_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE`,
    );

    for (const table of [
      'invoices',
      'invoice_payments',
      'credit_notes',
      'credit_note_refunds',
      'supplier_bills',
      'bill_payments',
      'goods_receipts',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD "fx_rate" numeric(18,8) NOT NULL DEFAULT '1'`,
      );
    }
    await queryRunner.query(`
      ALTER TABLE "journal_entries"
        ADD "currency" character(3),
        ADD "fx_rate" numeric(18,8) NOT NULL DEFAULT '1'`);

    // What received goods cost in base currency, so a bill in a foreign
    // currency clears goods-received-not-invoiced at the rate they came in at.
    await queryRunner.query(
      `ALTER TABLE "purchase_order_lines" ADD "received_value_base" numeric(14,4) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `UPDATE "purchase_order_lines" SET "received_value_base" = ROUND("qty_received" * "unit_cost", 4)`,
    );

    await queryRunner.query(`
      INSERT INTO "ledger_accounts" ("tenant_id", "code", "name", "type", "role", "is_system", "description")
      SELECT DISTINCT la."tenant_id", '7000', 'Exchange gains and losses', 'EXPENSE'::ledger_accounts_type_enum,
             'FX_GAIN_LOSS', true,
             'Differences between the rate a document was booked at and the rate it settled or was revalued at. A credit balance is a net gain.'
      FROM "ledger_accounts" la
      WHERE NOT EXISTS (
        SELECT 1 FROM "ledger_accounts" x
        WHERE x."tenant_id" = la."tenant_id" AND (x."role" = 'FX_GAIN_LOSS' OR x."code" = '7000') AND x."deletedAt" IS NULL
      )`);

    /* ---------------- billing ---------------- */
    await queryRunner.query(`
      CREATE TABLE "plans" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "code" character varying(40) NOT NULL,
        "name" character varying(80) NOT NULL,
        "description" text,
        "currency" character(3) NOT NULL,
        "price_per_seat" numeric(12,2) NOT NULL,
        "interval" character varying(10) NOT NULL DEFAULT 'MONTH',
        "trial_days" integer NOT NULL DEFAULT 14,
        "features" jsonb NOT NULL DEFAULT '[]',
        "provider_price_id" character varying(120),
        "is_active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_plans" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_plans_code" ON "plans" ("code")`,
    );
    await queryRunner.query(`
      INSERT INTO "plans" ("code", "name", "description", "currency", "price_per_seat", "interval", "trial_days", "features", "sort_order")
      VALUES
        ('starter', 'Starter', 'Quotes, invoices and a shared inbox for a small team.', 'USD', 19, 'MONTH', 14,
         '["Quotes and invoices","Customers and contacts","Shared inbox","Email support"]', 1),
        ('growth', 'Growth', 'Everything a made-to-order business runs on.', 'USD', 39, 'MONTH', 14,
         '["Everything in Starter","Purchasing, stock and bills","Production and work orders","Multi-currency and tax","AI assistant in chat"]', 2)`);

    await queryRunner.query(`
      CREATE TABLE "subscriptions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "plan_id" uuid,
        "status" character varying(20) NOT NULL DEFAULT 'TRIALING',
        "seats" integer NOT NULL DEFAULT 1,
        "trial_ends_at" TIMESTAMP WITH TIME ZONE,
        "current_period_end" TIMESTAMP WITH TIME ZONE,
        "cancel_at_period_end" boolean NOT NULL DEFAULT false,
        "past_due_since" TIMESTAMP WITH TIME ZONE,
        "failed_payment_count" integer NOT NULL DEFAULT 0,
        "provider" character varying(20) NOT NULL DEFAULT 'fake',
        "provider_customer_id" character varying(120),
        "provider_subscription_id" character varying(120),
        "pending_checkout_id" character varying(200),
        "seats_synced_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_subscriptions" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_subscriptions_seats" CHECK ("seats" >= 1)
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_subscriptions_tenant" ON "subscriptions" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_subscriptions_provider_subscription" ON "subscriptions" ("provider_subscription_id") WHERE "provider_subscription_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD CONSTRAINT "FK_subscriptions_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD CONSTRAINT "FK_subscriptions_plan" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(`
      CREATE TABLE "subscription_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "subscription_id" uuid NOT NULL,
        "plan_id" uuid NOT NULL,
        "quantity" integer NOT NULL,
        "provider_item_id" character varying(120),
        CONSTRAINT "PK_subscription_items" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_subscription_items_subscription" ON "subscription_items" ("subscription_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscription_items" ADD CONSTRAINT "FK_subscription_items_subscription" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE`,
    );

    // Webhooks are delivered at least once. The event id is the idempotency key.
    await queryRunner.query(`
      CREATE TABLE "billing_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "provider" character varying(20) NOT NULL,
        "provider_event_id" character varying(200) NOT NULL,
        "type" character varying(80) NOT NULL,
        "tenant_id" uuid,
        "payload" jsonb NOT NULL,
        CONSTRAINT "PK_billing_events" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_billing_events_provider_event" ON "billing_events" ("provider", "provider_event_id")`,
    );

    await queryRunner.query(`
      INSERT INTO "subscriptions" ("tenant_id", "status", "seats", "trial_ends_at")
      SELECT o."id", 'TRIALING',
             GREATEST(1, (SELECT COUNT(*) FROM "users" u WHERE u."organizationId" = o."id" AND u."isActive")),
             now() + interval '30 days'
      FROM "organizations" o
      ON CONFLICT DO NOTHING`);

    /* ---------------- notifications ---------------- */
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "type" character varying(40) NOT NULL,
        "title" character varying(200) NOT NULL,
        "body" text,
        "link" character varying(300),
        "entity_type" character varying(40),
        "entity_id" uuid,
        "read_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_notifications" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_notifications_user_unread" ON "notifications" ("user_id", "read_at", "created_at")`,
    );
    // One unread notification per thing per person: a quote resubmitted five
    // times is one item in the bell, not five.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_notifications_unread_entity" ON "notifications" ("user_id", "type", "entity_id") WHERE "read_at" IS NULL AND "entity_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "FK_notifications_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`DROP TABLE "billing_events"`);
    await queryRunner.query(`DROP TABLE "subscription_items"`);
    await queryRunner.query(`DROP TABLE "subscriptions"`);
    await queryRunner.query(`DROP TABLE "plans"`);
    await queryRunner.query(
      `UPDATE "ledger_accounts" SET "deletedAt" = now() WHERE "role" = 'FX_GAIN_LOSS'`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchase_order_lines" DROP COLUMN "received_value_base"`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_entries" DROP COLUMN "fx_rate", DROP COLUMN "currency"`,
    );
    for (const table of [
      'goods_receipts',
      'bill_payments',
      'supplier_bills',
      'credit_note_refunds',
      'credit_notes',
      'invoice_payments',
      'invoices',
    ]) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "fx_rate"`);
    }
    await queryRunner.query(`DROP TABLE "fx_rates"`);
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN "base_currency"`,
    );
  }
}
