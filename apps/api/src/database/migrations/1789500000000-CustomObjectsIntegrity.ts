import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Referential integrity for custom objects, saved views and production board
 * settings, none of which had a tenant FK.
 *
 * - tenant_id -> organizations(id) ON DELETE CASCADE on all seven tables.
 * - Same-tenant composite FKs: a child row's (tenant_id, parent_id) must match
 *   a parent's (tenant_id, id), so an attribute, relationship, record or link
 *   can never hang off another tenant's definition or record.
 * - custom_records.owner_id -> users ON DELETE SET NULL;
 *   saved_views.userId -> users ON DELETE CASCADE (personal views).
 * - At most one default saved view per (tenant, user, entity).
 * - custom_record_links.target_record_id is polymorphic (no FK possible):
 *     * BEFORE INSERT/UPDATE trigger checks the source belongs to the
 *       relationship's source object and the target is a live row of the
 *       relationship's target kind, in the link's tenant.
 *     * AFTER DELETE triggers on custom_records and on each core table a
 *       relationship can target remove links that point at the deleted row.
 *   Customers, contacts and purchase orders are soft-deleted (no SQL DELETE,
 *   so the trigger does not fire); the API filters links to soft-deleted
 *   targets on read instead. Custom records remove their links in the same
 *   transaction as their soft delete (CustomRecordsService.delete).
 *
 * Existing orphans abort the migration with a count rather than being
 * silently deleted; the constraints are added NOT VALID and then validated.
 * Keep CORE_TARGETS in step with CORE_ENTITY_TABLES in
 * modules/custom-objects/services/core-entity-bridge.service.ts.
 */

const TENANT_TABLES = [
  'custom_object_definitions',
  'custom_attribute_definitions',
  'custom_relationship_definitions',
  'custom_records',
  'custom_record_links',
  'saved_views',
  'production_board_settings',
] as const;

/** Parents that same-tenant composite FKs point at, and their (tenant_id, id) key. */
const TENANT_KEYS = [
  { table: 'custom_object_definitions', name: 'uq_custom_objects_tenant_id_id' },
  { table: 'custom_relationship_definitions', name: 'uq_custom_relationships_tenant_id_id' },
  { table: 'custom_records', name: 'uq_custom_records_tenant_id_id' },
] as const;

const SAME_TENANT_FKS = [
  {
    table: 'custom_attribute_definitions',
    column: 'object_id',
    parent: 'custom_object_definitions',
    name: 'FK_custom_attribute_definitions_tenant_object',
  },
  {
    table: 'custom_relationship_definitions',
    column: 'source_object_id',
    parent: 'custom_object_definitions',
    name: 'FK_custom_relationship_definitions_tenant_source',
  },
  {
    table: 'custom_relationship_definitions',
    column: 'target_object_id',
    parent: 'custom_object_definitions',
    name: 'FK_custom_relationship_definitions_tenant_target',
  },
  {
    table: 'custom_records',
    column: 'object_id',
    parent: 'custom_object_definitions',
    name: 'FK_custom_records_tenant_object',
  },
  {
    table: 'custom_record_links',
    column: 'relationship_id',
    parent: 'custom_relationship_definitions',
    name: 'FK_custom_record_links_tenant_relationship',
  },
  {
    table: 'custom_record_links',
    column: 'source_record_id',
    parent: 'custom_records',
    name: 'FK_custom_record_links_tenant_source',
  },
] as const;

const USER_FKS = [
  {
    table: 'custom_records',
    column: 'owner_id',
    name: 'FK_custom_records_owner_id',
    onDelete: 'SET NULL',
  },
  {
    table: 'saved_views',
    column: 'userId',
    name: 'FK_saved_views_user_id',
    onDelete: 'CASCADE',
  },
] as const;

/** Core entity kind -> table, and whether its rows are soft-deleted. */
const CORE_TARGETS = [
  { kind: 'customer', table: 'customers', softDeleted: true },
  { kind: 'contact', table: 'contacts', softDeleted: true },
  { kind: 'quote', table: 'quotes', softDeleted: false },
  { kind: 'order', table: 'sales_orders', softDeleted: false },
  { kind: 'work_order', table: 'work_orders', softDeleted: false },
  { kind: 'purchase_order', table: 'purchase_orders', softDeleted: true },
] as const;

const coreTriggerName = (table: string) => `trg_${table}_drop_custom_record_links`;
const CUSTOM_TARGET_TRIGGER = 'trg_custom_records_drop_target_links';
const CHECK_TARGET_TRIGGER = 'trg_custom_record_links_check_target';
const DEFAULT_VIEW_INDEX = 'uq_saved_views_one_default';

export class CustomObjectsIntegrity1789500000000 implements MigrationInterface {
  name = 'CustomObjectsIntegrity1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The orphan checks must see every tenant's rows (FORCE RLS applies to
    // the table owner too). Transaction-local.
    await queryRunner.query(`SELECT set_config('app.bypass_rls', 'on', true)`);

    await this.assertNoOrphans(queryRunner);

    // The bug this index guards against may already have produced several
    // defaults: keep the most recently updated one per slot.
    await queryRunner.query(`
      UPDATE "saved_views" v SET "isDefault" = false
      WHERE v."isDefault" = true AND v."deletedAt" IS NULL AND EXISTS (
        SELECT 1 FROM "saved_views" n
        WHERE n."tenant_id" = v."tenant_id" AND n."userId" = v."userId"
          AND n."entityType" = v."entityType" AND n."isDefault" = true AND n."deletedAt" IS NULL
          AND (n."updatedAt", n."id") > (v."updatedAt", v."id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "${DEFAULT_VIEW_INDEX}" ON "saved_views" ("tenant_id", "userId", "entityType") WHERE "isDefault" = true AND "deletedAt" IS NULL`,
    );

    for (const table of TENANT_TABLES) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "FK_${table}_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE NOT VALID`,
      );
      await queryRunner.query(`ALTER TABLE "${table}" VALIDATE CONSTRAINT "FK_${table}_tenant_id"`);
    }

    for (const { table, name } of TENANT_KEYS) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" UNIQUE ("tenant_id", "id")`,
      );
    }
    for (const { table, column, parent, name } of SAME_TENANT_FKS) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" FOREIGN KEY ("tenant_id", "${column}") REFERENCES "${parent}"("tenant_id", "id") ON DELETE CASCADE NOT VALID`,
      );
      await queryRunner.query(`ALTER TABLE "${table}" VALIDATE CONSTRAINT "${name}"`);
    }

    for (const { table, column, name, onDelete } of USER_FKS) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}") REFERENCES "users"("id") ON DELETE ${onDelete} NOT VALID`,
      );
      await queryRunner.query(`ALTER TABLE "${table}" VALIDATE CONSTRAINT "${name}"`);
    }

    // ── Polymorphic link target: validate on write ──────────────────────
    const tableCase = CORE_TARGETS.map(({ kind, table }) => `WHEN '${kind}' THEN '${table}'`).join(
      ' ',
    );
    const softCase = CORE_TARGETS.map(({ kind, softDeleted }) => `WHEN '${kind}' THEN ${softDeleted}`).join(
      ' ',
    );
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION custom_record_links_check_target() RETURNS trigger
      LANGUAGE plpgsql AS $fn$
      DECLARE
        rel record;
        target_table text;
        soft_deleted boolean;
        target_found boolean;
      BEGIN
        SELECT "source_object_id", "target_type", "target_object_id", "target_core_entity"
          INTO rel
          FROM "custom_relationship_definitions"
         WHERE "id" = NEW."relationship_id" AND "tenant_id" = NEW."tenant_id";
        IF NOT FOUND THEN
          RAISE EXCEPTION 'custom_record_links: relationship % not found in tenant %', NEW."relationship_id", NEW."tenant_id"
            USING ERRCODE = 'foreign_key_violation';
        END IF;
        IF NEW."target_type" IS DISTINCT FROM rel."target_type" THEN
          RAISE EXCEPTION 'custom_record_links: target_type % does not match relationship (%)', NEW."target_type", rel."target_type"
            USING ERRCODE = 'check_violation';
        END IF;
        PERFORM 1 FROM "custom_records"
         WHERE "id" = NEW."source_record_id" AND "tenant_id" = NEW."tenant_id"
           AND "object_id" = rel."source_object_id" AND "deletedAt" IS NULL;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'custom_record_links: source record % is not a live record of the relationship source object', NEW."source_record_id"
            USING ERRCODE = 'foreign_key_violation';
        END IF;

        IF rel."target_type" = 'custom_object' THEN
          PERFORM 1 FROM "custom_records"
           WHERE "id" = NEW."target_record_id" AND "tenant_id" = NEW."tenant_id"
             AND "object_id" = rel."target_object_id" AND "deletedAt" IS NULL;
          target_found := FOUND;
        ELSE
          target_table := CASE rel."target_core_entity" ${tableCase} END;
          soft_deleted := CASE rel."target_core_entity" ${softCase} END;
          IF target_table IS NULL THEN
            RAISE EXCEPTION 'custom_record_links: unsupported core entity %', rel."target_core_entity"
              USING ERRCODE = 'check_violation';
          END IF;
          EXECUTE format(
            'SELECT EXISTS (SELECT 1 FROM %I WHERE "id" = $1 AND "tenant_id" = $2%s)',
            target_table,
            CASE WHEN soft_deleted THEN ' AND "deletedAt" IS NULL' ELSE '' END
          ) INTO target_found USING NEW."target_record_id", NEW."tenant_id";
        END IF;
        IF NOT target_found THEN
          RAISE EXCEPTION 'custom_record_links: target % not found in tenant %', NEW."target_record_id", NEW."tenant_id"
            USING ERRCODE = 'foreign_key_violation';
        END IF;
        RETURN NEW;
      END
      $fn$
    `);
    await queryRunner.query(
      `CREATE TRIGGER "${CHECK_TARGET_TRIGGER}" BEFORE INSERT OR UPDATE OF "tenant_id", "relationship_id", "source_record_id", "target_type", "target_record_id" ON "custom_record_links" FOR EACH ROW EXECUTE FUNCTION custom_record_links_check_target()`,
    );

    // ── Polymorphic link target: clean up on hard delete ────────────────
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION custom_record_links_drop_for_core() RETURNS trigger
      LANGUAGE plpgsql AS $fn$
      BEGIN
        DELETE FROM "custom_record_links" l
         USING "custom_relationship_definitions" r
         WHERE l."relationship_id" = r."id"
           AND l."tenant_id" = OLD."tenant_id"
           AND l."target_type" = 'core_entity'
           AND l."target_record_id" = OLD."id"
           AND r."target_core_entity" = TG_ARGV[0];
        RETURN OLD;
      END
      $fn$
    `);
    for (const { kind, table } of CORE_TARGETS) {
      await queryRunner.query(
        `CREATE TRIGGER "${coreTriggerName(table)}" AFTER DELETE ON "${table}" FOR EACH ROW EXECUTE FUNCTION custom_record_links_drop_for_core('${kind}')`,
      );
    }

    // Links whose source is the record cascade via FK; links that target it don't.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION custom_record_links_drop_for_custom_target() RETURNS trigger
      LANGUAGE plpgsql AS $fn$
      BEGIN
        DELETE FROM "custom_record_links"
         WHERE "tenant_id" = OLD."tenant_id"
           AND "target_type" = 'custom_object'
           AND "target_record_id" = OLD."id";
        RETURN OLD;
      END
      $fn$
    `);
    await queryRunner.query(
      `CREATE TRIGGER "${CUSTOM_TARGET_TRIGGER}" AFTER DELETE ON "custom_records" FOR EACH ROW EXECUTE FUNCTION custom_record_links_drop_for_custom_target()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "${CUSTOM_TARGET_TRIGGER}" ON "custom_records"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS custom_record_links_drop_for_custom_target()`);
    for (const { table } of CORE_TARGETS) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS "${coreTriggerName(table)}" ON "${table}"`);
    }
    await queryRunner.query(`DROP FUNCTION IF EXISTS custom_record_links_drop_for_core()`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "${CHECK_TARGET_TRIGGER}" ON "custom_record_links"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS custom_record_links_check_target()`);

    for (const { table, name } of USER_FKS) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${name}"`);
    }
    for (const { table, name } of SAME_TENANT_FKS) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${name}"`);
    }
    for (const { table, name } of TENANT_KEYS) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${name}"`);
    }
    for (const table of TENANT_TABLES) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "FK_${table}_tenant_id"`,
      );
    }
    await queryRunner.query(`DROP INDEX IF EXISTS "${DEFAULT_VIEW_INDEX}"`);
  }

  /** Counts every row the new constraints would reject; aborts if any. */
  private async assertNoOrphans(queryRunner: QueryRunner): Promise<void> {
    const checks: { what: string; sql: string }[] = [];

    for (const table of TENANT_TABLES) {
      checks.push({
        what: `"${table}" rows whose tenant_id has no organization`,
        sql: `SELECT count(*) AS count FROM "${table}" c WHERE NOT EXISTS (SELECT 1 FROM "organizations" o WHERE o."id" = c."tenant_id")`,
      });
    }
    for (const { table, column, parent } of SAME_TENANT_FKS) {
      checks.push({
        what: `"${table}"."${column}" pointing at a "${parent}" row of another tenant`,
        sql: `SELECT count(*) AS count FROM "${table}" c JOIN "${parent}" p ON p."id" = c."${column}" WHERE p."tenant_id" <> c."tenant_id"`,
      });
    }
    for (const { table, column } of USER_FKS) {
      checks.push({
        what: `"${table}"."${column}" pointing at a missing user`,
        sql: `SELECT count(*) AS count FROM "${table}" c WHERE c."${column}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = c."${column}")`,
      });
    }

    const failures: string[] = [];
    for (const { what, sql } of checks) {
      const [row] = await queryRunner.query(sql);
      const count = Number(row?.count ?? 0);
      if (count > 0) failures.push(`${count} ${what}`);
    }
    if (failures.length) {
      throw new Error(
        `CustomObjectsIntegrity1789500000000: fix or remove these rows before migrating:\n  - ${failures.join('\n  - ')}`,
      );
    }
  }
}
