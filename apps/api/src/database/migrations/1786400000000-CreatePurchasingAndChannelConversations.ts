import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Purchasing (suppliers, price lists, purchase orders) plus the generalised
 * chat conversation state that replaces `pending_channel_commands`.
 *
 * Number is in the S2 band (1786400000000–1786490000000) per the integration
 * rules, so run order follows sprint order regardless of merge order.
 */
export class CreatePurchasingAndChannelConversations1786400000000 implements MigrationInterface {
  name = 'CreatePurchasingAndChannelConversations1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "purchase_orders_status_enum" AS ENUM ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "record_origin_enum" AS ENUM ('HUMAN', 'AI_ASSISTED', 'AI_DRAFTED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "channel_conversations_status_enum" AS ENUM ('COLLECTING', 'AWAITING_CONFIRM', 'CONFIRMED', 'CANCELLED', 'EXPIRED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "channel_conversations_provider_enum" AS ENUM ('WHATSAPP_META', 'TELEGRAM', 'EMAIL_SMTP', 'EMAIL_RESEND')`,
    );

    await queryRunner.query(`
      CREATE TABLE "suppliers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "tenant_id" uuid NOT NULL,
        "company_name" character varying(120) NOT NULL,
        "contact_name" character varying(120),
        "email" character varying(255),
        "phone" character varying(40),
        "address_line1" character varying(160),
        "address_line2" character varying(160),
        "city" character varying(80),
        "postal_code" character varying(20),
        "country" character varying(80),
        "tax_id" character varying(40),
        "currency" character(3),
        "payment_terms_days" integer,
        "lead_time_days" integer,
        "is_active" boolean NOT NULL DEFAULT true,
        "notes" text,
        CONSTRAINT "PK_suppliers" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_suppliers_tenant" ON "suppliers" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_suppliers_tenant_name" ON "suppliers" ("tenant_id", "company_name") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "suppliers" ADD CONSTRAINT "FK_suppliers_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(`
      CREATE TABLE "supplier_materials" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "supplier_id" uuid NOT NULL,
        "material_id" uuid NOT NULL,
        "supplier_sku" character varying(60),
        "unit_cost" numeric(14,4) NOT NULL DEFAULT '0',
        "min_order_qty" numeric(14,4),
        "lead_time_days" integer,
        "is_preferred" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_supplier_materials" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_supplier_materials_tenant" ON "supplier_materials" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_supplier_materials_supplier_material" ON "supplier_materials" ("supplier_id", "material_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "supplier_materials" ADD CONSTRAINT "FK_supplier_materials_supplier" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "supplier_materials" ADD CONSTRAINT "FK_supplier_materials_material" FOREIGN KEY ("material_id") REFERENCES "catalog_materials"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(`
      CREATE TABLE "purchase_orders" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "tenant_id" uuid NOT NULL,
        "po_number" character varying(40) NOT NULL,
        "supplier_id" uuid NOT NULL,
        "supplier_name" character varying(120) NOT NULL,
        "status" "purchase_orders_status_enum" NOT NULL DEFAULT 'DRAFT',
        "currency" character(3) NOT NULL DEFAULT 'USD',
        "order_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "expected_date" TIMESTAMP WITH TIME ZONE,
        "subtotal_amount" numeric(12,2) NOT NULL DEFAULT '0',
        "total_amount" numeric(12,2) NOT NULL DEFAULT '0',
        "notes" text,
        "origin" "record_origin_enum" NOT NULL DEFAULT 'HUMAN',
        "origin_channel" character varying(20),
        "origin_message_id" character varying(255),
        "origin_model" character varying(120),
        "origin_prompt_version" character varying(40),
        "created_by_id" uuid,
        CONSTRAINT "PK_purchase_orders" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_purchase_orders_tenant" ON "purchase_orders" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_purchase_orders_tenant_number" ON "purchase_orders" ("tenant_id", "po_number") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchase_orders" ADD CONSTRAINT "FK_purchase_orders_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchase_orders" ADD CONSTRAINT "FK_purchase_orders_supplier" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT`,
    );

    await queryRunner.query(`
      CREATE TABLE "purchase_order_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "purchase_order_id" uuid NOT NULL,
        "material_id" uuid,
        "description" character varying(255) NOT NULL,
        "qty_ordered" numeric(14,4) NOT NULL DEFAULT '0',
        "qty_received" numeric(14,4) NOT NULL DEFAULT '0',
        "uom" character varying(10) NOT NULL,
        "unit_cost" numeric(14,4) NOT NULL DEFAULT '0',
        "line_total" numeric(12,2) NOT NULL DEFAULT '0',
        CONSTRAINT "PK_purchase_order_lines" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_purchase_order_lines_po" ON "purchase_order_lines" ("purchase_order_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "FK_purchase_order_lines_po" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(`
      CREATE TABLE "channel_conversations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "provider" "channel_conversations_provider_enum" NOT NULL,
        "sender_identifier" character varying(255) NOT NULL,
        "skill_name" character varying(60) NOT NULL,
        "slots" jsonb NOT NULL DEFAULT '{}',
        "status" "channel_conversations_status_enum" NOT NULL DEFAULT 'COLLECTING',
        "pending_question" text,
        "result_type" character varying(30),
        "result_id" uuid,
        "idempotency_key" character varying(120),
        "origin_message_id" character varying(255),
        "origin_model" character varying(120),
        "origin_prompt_version" character varying(40),
        "confidence" numeric(4,3),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "resolved_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_channel_conversations" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_channel_conversations_idempotency" UNIQUE ("idempotency_key")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_channel_conversations_lookup" ON "channel_conversations" ("organization_id", "provider", "sender_identifier", "status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_conversations" ADD CONSTRAINT "FK_channel_conversations_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE`,
    );

    // Carry any in-flight quote approvals across, so a pending confirmation
    // sent just before deploy is not silently dropped. `slots` is left empty:
    // an already-proposed command has to be re-stated rather than resumed,
    // because the old row never stored the resolved value the new executor
    // needs. Marking them EXPIRED is the honest outcome.
    await queryRunner.query(`
      INSERT INTO "channel_conversations"
        ("organization_id", "user_id", "provider", "sender_identifier", "skill_name",
         "slots", "status", "result_type", "result_id", "created_at", "expires_at", "resolved_at")
      SELECT "organizationId", "userId", "provider"::text::"channel_conversations_provider_enum",
             "senderIdentifier", 'quote.approve', '{}'::jsonb,
             CASE WHEN "status" = 'CONFIRMED' THEN 'CONFIRMED'::"channel_conversations_status_enum"
                  WHEN "status" = 'CANCELLED' THEN 'CANCELLED'::"channel_conversations_status_enum"
                  ELSE 'EXPIRED'::"channel_conversations_status_enum" END,
             'QUOTE', "quoteId", "createdAt", "expiresAt", COALESCE("resolvedAt", now())
      FROM "pending_channel_commands"
    `);

    await queryRunner.query(`DROP TABLE "pending_channel_commands"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "pending_channel_commands_action_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "pending_channel_commands_status_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "pending_channel_commands_action_enum" AS ENUM ('APPROVE', 'APPROVE_AND_SEND')`,
    );
    await queryRunner.query(
      `CREATE TYPE "pending_channel_commands_status_enum" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED')`,
    );
    await queryRunner.query(`
      CREATE TABLE "pending_channel_commands" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organizationId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "provider" character varying NOT NULL,
        "senderIdentifier" character varying(255) NOT NULL,
        "action" "pending_channel_commands_action_enum" NOT NULL,
        "quoteId" uuid NOT NULL,
        "status" "pending_channel_commands_status_enum" NOT NULL DEFAULT 'PENDING',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "resolvedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_pending_channel_commands" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_pending_channel_commands_lookup" ON "pending_channel_commands" ("organizationId", "provider", "senderIdentifier", "status")`,
    );

    await queryRunner.query(`DROP TABLE "channel_conversations"`);
    await queryRunner.query(`DROP TABLE "purchase_order_lines"`);
    await queryRunner.query(`DROP TABLE "purchase_orders"`);
    await queryRunner.query(`DROP TABLE "supplier_materials"`);
    await queryRunner.query(`DROP TABLE "suppliers"`);
    await queryRunner.query(`DROP TYPE "channel_conversations_provider_enum"`);
    await queryRunner.query(`DROP TYPE "channel_conversations_status_enum"`);
    await queryRunner.query(`DROP TYPE "record_origin_enum"`);
    await queryRunner.query(`DROP TYPE "purchase_orders_status_enum"`);
  }
}
