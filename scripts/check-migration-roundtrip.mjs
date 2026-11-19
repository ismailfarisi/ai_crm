#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const api = join(root, 'apps', 'api');
const require = createRequire(join(api, 'package.json'));
process.chdir(api);

let dataSource;
let step =
  'load compiled migrations (run pnpm check:migrations to build first)';
try {
  const sourceFiles = readdirSync(join(api, 'src/database/migrations'))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => file.slice(0, -3))
    .sort();
  const compiledFiles = readdirSync(join(api, 'dist/database/migrations'))
    .filter((file) => file.endsWith('.js'))
    .map((file) => file.slice(0, -3))
    .sort();
  assert(sourceFiles.length > 0, 'No source migrations found');
  assert.deepEqual(
    compiledFiles,
    sourceFiles,
    'Compiled migrations must match source files',
  );

  ({
    MigrationDataSource: dataSource,
  } = require('./dist/database/migration-data-source.js'));
  const { MigrationExecutor } = require('typeorm');
  await dataSource.initialize();
  assert.equal(
    dataSource.migrations.length,
    sourceFiles.length,
    'Not all migrations are registered',
  );
  const executor = new MigrationExecutor(dataSource);
  const recorded = () => executor.getExecutedMigrations();
  const expected = sourceFiles.length;
  step = 'check fresh database';
  assert.equal(
    (await recorded()).length,
    0,
    'Use a fresh disposable database; this check reverts every migration',
  );

  async function up(label) {
    step = label;
    console.log(`[roundtrip] ${label}: applying ${expected} migrations`);
    await dataSource.runMigrations({ transaction: 'all' });
    assert.equal(
      (await recorded()).length,
      expected,
      'Recorded migration count does not match source files',
    );
    console.log(`[roundtrip] ${label}: ${expected} migrations recorded`);
  }

  await up('initial up');
  for (let attempt = 0; attempt < expected + 1; attempt++) {
    const migrations = await recorded();
    if (migrations.length === 0) break;
    const latest = migrations.reduce((a, b) => (a.id > b.id ? a : b));
    step = `down ${latest.name}`;
    console.log(`[roundtrip] ${step} (${migrations.length} remaining)`);
    await dataSource.undoLastMigration({ transaction: 'all' });
    assert.equal(
      (await recorded()).length,
      migrations.length - 1,
      `${latest.name} did not remove exactly one migration record`,
    );
    step = `re-up ${latest.name}`;
    console.log(`[roundtrip] ${step} (restore ${migrations.length} recorded)`);
    const allMigrations = dataSource.migrations;
    try {
      dataSource.migrations = allMigrations.filter(
        (migration) =>
          (migration.name ?? migration.constructor.name) === latest.name,
      );
      assert.equal(
        dataSource.migrations.length,
        1,
        `Cannot isolate ${latest.name}`,
      );
      const applied = await dataSource.runMigrations({ transaction: 'all' });
      assert.deepEqual(
        applied.map((migration) => migration.name),
        [latest.name],
      );
    } finally {
      dataSource.migrations = allMigrations;
    }
    assert.equal(
      (await recorded()).length,
      migrations.length,
      `${latest.name} re-up did not restore the migration count`,
    );
    step = `second down ${latest.name}`;
    console.log(`[roundtrip] ${step}`);
    await dataSource.undoLastMigration({ transaction: 'all' });
    assert.equal(
      (await recorded()).length,
      migrations.length - 1,
      `${latest.name} second down did not remove exactly one migration record`,
    );
  }
  step = 'assert zero after rollback';
  assert.equal(
    (await recorded()).length,
    0,
    `Rollback exceeded safety bound of ${expected + 1}`,
  );
  console.log('[roundtrip] down: 0 migrations recorded');
  await up('second up');
  console.log(
    `[roundtrip] PASS: each migration down->up->down; ${expected} up -> 0 -> ${expected} up`,
  );
} catch (error) {
  console.error(`[roundtrip] FAIL during ${step}: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (dataSource?.isInitialized) await dataSource.destroy();
}
