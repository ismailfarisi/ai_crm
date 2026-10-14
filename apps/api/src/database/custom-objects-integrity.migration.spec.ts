import { RELATIONSHIP_CORE_ENTITIES } from '@saas/shared';
import { CORE_ENTITY_TABLES } from '@/modules/custom-objects/services/core-entity-bridge.service';
import { CustomObjectsIntegrity1789500000000 } from './migrations/1789500000000-CustomObjectsIntegrity';

/**
 * No database runs in unit tests, so this pins the DDL the migration emits:
 * the constraints, index and triggers the services now rely on, the orphan
 * pre-checks, and a down() that undoes all of it.
 */
describe('CustomObjectsIntegrity1789500000000', () => {
  const TENANT_TABLES = [
    'custom_object_definitions',
    'custom_attribute_definitions',
    'custom_relationship_definitions',
    'custom_records',
    'custom_record_links',
    'saved_views',
    'production_board_settings',
  ];

  let queries: string[];
  let runner: any;
  let orphanCounts: Record<string, number>;

  beforeEach(() => {
    queries = [];
    orphanCounts = {};
    runner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (/count\(\*\)/i.test(sql)) {
          const hit = Object.entries(orphanCounts).find(([needle]) => sql.includes(needle));
          return [{ count: String(hit ? hit[1] : 0) }];
        }
        return [];
      }),
    };
  });

  const up = () => new CustomObjectsIntegrity1789500000000().up(runner);
  const down = () => new CustomObjectsIntegrity1789500000000().down(runner);
  const all = () => queries.join('\n');

  it('adds tenant_id -> organizations FKs (NOT VALID, then VALIDATE) on every table', async () => {
    await up();
    for (const table of TENANT_TABLES) {
      const add = queries.find(
        (q) =>
          q.includes(`ALTER TABLE "${table}" ADD CONSTRAINT "FK_${table}_tenant_id"`) &&
          q.includes('REFERENCES "organizations"("id") ON DELETE CASCADE') &&
          q.includes('NOT VALID'),
      );
      expect(add).toBeDefined();
      expect(all()).toContain(`ALTER TABLE "${table}" VALIDATE CONSTRAINT "FK_${table}_tenant_id"`);
    }
  });

  it('pins children to their parent tenant with composite FKs', async () => {
    await up();
    const sql = all();
    for (const [table, column, parent] of [
      ['custom_attribute_definitions', 'object_id', 'custom_object_definitions'],
      ['custom_relationship_definitions', 'source_object_id', 'custom_object_definitions'],
      ['custom_relationship_definitions', 'target_object_id', 'custom_object_definitions'],
      ['custom_records', 'object_id', 'custom_object_definitions'],
      ['custom_record_links', 'relationship_id', 'custom_relationship_definitions'],
      ['custom_record_links', 'source_record_id', 'custom_records'],
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `ALTER TABLE "${table}" ADD CONSTRAINT "\\w+" FOREIGN KEY \\("tenant_id", "${column}"\\) ` +
            `REFERENCES "${parent}"\\("tenant_id", "id"\\) ON DELETE CASCADE NOT VALID`,
        ),
      );
    }
    for (const parent of [
      'custom_object_definitions',
      'custom_relationship_definitions',
      'custom_records',
    ]) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE "${parent}" ADD CONSTRAINT "\\w+" UNIQUE \\("tenant_id", "id"\\)`));
    }
  });

  it('adds user FKs: record owner SET NULL, saved view owner CASCADE', async () => {
    await up();
    expect(all()).toMatch(
      /ALTER TABLE "custom_records" ADD CONSTRAINT "FK_custom_records_owner_id" FOREIGN KEY \("owner_id"\) REFERENCES "users"\("id"\) ON DELETE SET NULL NOT VALID/,
    );
    expect(all()).toMatch(
      /ALTER TABLE "saved_views" ADD CONSTRAINT "FK_saved_views_user_id" FOREIGN KEY \("userId"\) REFERENCES "users"\("id"\) ON DELETE CASCADE NOT VALID/,
    );
  });

  it('adds the one-default-view partial unique index, matching the entity decorator', async () => {
    await up();
    expect(all()).toContain(
      'CREATE UNIQUE INDEX "uq_saved_views_one_default" ON "saved_views" ("tenant_id", "userId", "entityType") WHERE "isDefault" = true AND "deletedAt" IS NULL',
    );
  });

  it('clears duplicate defaults (keeping the newest) before building the index', async () => {
    await up();
    const dedupe = queries.findIndex((q) => /UPDATE "saved_views"( \w+)? SET "isDefault" = false/.test(q));
    const index = queries.findIndex((q) => q.includes('"uq_saved_views_one_default"'));
    expect(dedupe).toBeGreaterThanOrEqual(0);
    expect(dedupe).toBeLessThan(index);
  });

  it('installs an AFTER DELETE link-cleanup trigger on every core table a relationship can target', async () => {
    await up();
    expect(Object.keys(CORE_ENTITY_TABLES).sort()).toEqual([...RELATIONSHIP_CORE_ENTITIES].sort());
    for (const [kind, { table }] of Object.entries(CORE_ENTITY_TABLES)) {
      expect(all()).toMatch(
        new RegExp(
          `CREATE TRIGGER "\\w+" AFTER DELETE ON "${table}" FOR EACH ROW EXECUTE FUNCTION custom_record_links_drop_for_core\\('${kind}'\\)`,
        ),
      );
    }
    expect(all()).toMatch(
      /CREATE TRIGGER "\w+" AFTER DELETE ON "custom_records" FOR EACH ROW EXECUTE FUNCTION custom_record_links_drop_for_custom_target\(\)/,
    );
  });

  it('installs a link target check trigger covering every core table', async () => {
    await up();
    const fn = queries.find((q) => q.includes('FUNCTION custom_record_links_check_target()'));
    expect(fn).toBeDefined();
    for (const [kind, { table }] of Object.entries(CORE_ENTITY_TABLES)) {
      expect(fn).toContain(`WHEN '${kind}' THEN '${table}'`);
    }
    expect(all()).toMatch(/CREATE TRIGGER "\w+" BEFORE INSERT OR UPDATE .* ON "custom_record_links"/);
  });

  it('fails loudly, before altering anything, when orphans exist', async () => {
    orphanCounts['"saved_views"'] = 3;
    await expect(up()).rejects.toThrow(/saved_views/);
    expect(queries.some((q) => /^\s*ALTER TABLE/.test(q))).toBe(false);
  });

  it('down() drops every constraint, index, trigger and function up() created', async () => {
    await up();
    const created = new Set<string>();
    for (const q of queries) {
      for (const m of q.matchAll(/ADD CONSTRAINT "(\w+)"|CREATE (?:UNIQUE )?INDEX "(\w+)"|CREATE TRIGGER "(\w+)"|FUNCTION (\w+)\(\)/g)) {
        created.add(m[1] ?? m[2] ?? m[3] ?? m[4]);
      }
    }
    expect(created.size).toBeGreaterThan(20);

    queries = [];
    await down();
    const dropped = all();
    for (const name of created) {
      expect(dropped).toContain(name);
    }
  });
});
