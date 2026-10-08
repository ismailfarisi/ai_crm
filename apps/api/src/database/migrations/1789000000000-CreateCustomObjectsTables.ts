import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomObjectsTables1789000000000 implements MigrationInterface {
  name = 'CreateCustomObjectsTables1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "custom_object_definitions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" character varying(80) NOT NULL,
        "singular_name" character varying(80) NOT NULL,
        "slug" character varying(80) NOT NULL,
        "icon" character varying(40) NOT NULL DEFAULT 'Box',
        "description" text,
        "primary_attribute_slug" character varying(80) NOT NULL,
        "is_archived" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_custom_object_definitions_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_custom_objects_tenant_slug" UNIQUE ("tenant_id", "slug")
      );
      CREATE INDEX IF NOT EXISTS "idx_custom_objects_tenant" ON "custom_object_definitions" ("tenant_id", "is_archived");

      CREATE TABLE IF NOT EXISTS "custom_attribute_definitions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "object_id" uuid NOT NULL,
        "name" character varying(80) NOT NULL,
        "slug" character varying(80) NOT NULL,
        "type" character varying(30) NOT NULL,
        "is_required" boolean NOT NULL DEFAULT false,
        "is_unique" boolean NOT NULL DEFAULT false,
        "is_searchable" boolean NOT NULL DEFAULT true,
        "default_value" jsonb,
        "options" jsonb,
        "validation_rules" jsonb,
        "sort_order" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_custom_attribute_definitions_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_custom_attribute_definitions_object_id" FOREIGN KEY ("object_id") REFERENCES "custom_object_definitions"("id") ON DELETE CASCADE,
        CONSTRAINT "uq_custom_attributes_object_slug" UNIQUE ("object_id", "slug")
      );
      CREATE INDEX IF NOT EXISTS "idx_custom_attributes_object" ON "custom_attribute_definitions" ("object_id", "sort_order");

      CREATE TABLE IF NOT EXISTS "custom_relationship_definitions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "source_object_id" uuid NOT NULL,
        "target_type" character varying(30) NOT NULL,
        "target_object_id" uuid,
        "target_core_entity" character varying(40),
        "name" character varying(80) NOT NULL,
        "slug" character varying(80) NOT NULL,
        "cardinality" character varying(30) NOT NULL DEFAULT 'many_to_one',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_custom_relationship_definitions_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_custom_relationship_definitions_source_object_id" FOREIGN KEY ("source_object_id") REFERENCES "custom_object_definitions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_custom_relationship_definitions_target_object_id" FOREIGN KEY ("target_object_id") REFERENCES "custom_object_definitions"("id") ON DELETE CASCADE,
        CONSTRAINT "uq_custom_rel_source_slug" UNIQUE ("source_object_id", "slug")
      );

      CREATE TABLE IF NOT EXISTS "custom_records" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "object_id" uuid NOT NULL,
        "owner_id" uuid,
        "values" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_custom_records_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_custom_records_object_id" FOREIGN KEY ("object_id") REFERENCES "custom_object_definitions"("id") ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS "idx_custom_records_tenant_obj" ON "custom_records" ("tenant_id", "object_id", "createdAt" DESC);
      CREATE INDEX IF NOT EXISTS "idx_custom_records_owner" ON "custom_records" ("tenant_id", "owner_id");
      CREATE INDEX IF NOT EXISTS "idx_custom_records_values_gin" ON "custom_records" USING GIN ("values");

      CREATE TABLE IF NOT EXISTS "custom_record_links" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "relationship_id" uuid NOT NULL,
        "source_record_id" uuid NOT NULL,
        "target_type" character varying(30) NOT NULL,
        "target_record_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_custom_record_links_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_custom_record_links_relationship_id" FOREIGN KEY ("relationship_id") REFERENCES "custom_relationship_definitions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_custom_record_links_source_record_id" FOREIGN KEY ("source_record_id") REFERENCES "custom_records"("id") ON DELETE CASCADE,
        CONSTRAINT "uq_record_links_unique_edge" UNIQUE ("relationship_id", "source_record_id", "target_record_id")
      );
      CREATE INDEX IF NOT EXISTS "idx_record_links_source" ON "custom_record_links" ("tenant_id", "relationship_id", "source_record_id");
      CREATE INDEX IF NOT EXISTS "idx_record_links_target" ON "custom_record_links" ("tenant_id", "target_record_id");
    `);

    // Enable Row-Level Security on all 5 tables
    const tables = [
      'custom_object_definitions',
      'custom_attribute_definitions',
      'custom_relationship_definitions',
      'custom_records',
      'custom_record_links',
    ];
    for (const table of tables) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);
      await queryRunner.query(
        `CREATE POLICY tenant_isolation_policy ON "${table}" FOR ALL ` +
          `USING (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
          `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_record_links"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_records"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_relationship_definitions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_attribute_definitions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_object_definitions"`);
  }
}
