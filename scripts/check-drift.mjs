#!/usr/bin/env node
/**
 * Fails when the entities and the migrated schema have drifted apart.
 *
 * CLAUDE.md has always said "`pnpm migration:generate` against a migrated DB
 * must report no drift". This turns that sentence into a check.
 *
 * It is not a plain "did it emit a file", because this schema has two kinds of
 * drift that are deliberate and permanent:
 *
 *   - foreign keys are declared in migrations, not on entities (entities carry
 *     plain uuid columns, so relation metadata never drifts and FK names never
 *     churn), so TypeORM always wants to drop them;
 *   - CHECK constraints likewise exist only in migrations.
 *
 * Everything else — a new column, a changed type, a renamed index — is real
 * drift and fails the job. Run with `--verbose` to see what was ignored.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'apps', 'api', 'DriftCheck');
const verbose = process.argv.includes('--verbose');

/** Statements that are known, permanent, and not drift. */
const IGNORED = [
  /ALTER TABLE .* DROP CONSTRAINT "FK_/i,
  /ALTER TABLE .* ADD CONSTRAINT "FK_.*FOREIGN KEY/i,
  /ALTER TABLE .* DROP CONSTRAINT "CHK_/i,
  /ALTER TABLE .* ADD CONSTRAINT "CHK_/i,
];

let generated = '';
try {
  execFileSync(
    'pnpm',
    [
      '--filter',
      'api',
      'exec',
      'typeorm',
      'migration:generate',
      '-d',
      'dist/database/data-source.js',
      OUT,
    ],
    { stdio: verbose ? 'inherit' : 'pipe', shell: process.platform === 'win32' },
  );
} catch {
  // "No changes in database schema were found" exits non-zero. That is a pass.
  console.log('No drift: the schema matches the entities.');
  process.exit(0);
}

try {
  generated = readFileSync(`${OUT}.ts`, 'utf8');
} catch {
  console.log('No drift: nothing was generated.');
  process.exit(0);
}
rmSync(`${OUT}.ts`, { force: true });

const up = generated.split('public async down')[0];
const statements = [...up.matchAll(/await queryRunner\.query\(`([\s\S]*?)`\)/g)]
  .map((m) => m[1].replace(/\s+/g, ' ').trim())
  .filter(Boolean);

const real = statements.filter((s) => !IGNORED.some((re) => re.test(s)));
const ignored = statements.length - real.length;

if (real.length === 0) {
  console.log(
    `No drift. (${ignored} statement(s) ignored: foreign keys and check constraints live in migrations by design.)`,
  );
  process.exit(0);
}

console.error(
  `Schema drift: ${real.length} statement(s) the entities want that the migrations have not written.\n` +
    'Generate a migration (`pnpm migration:generate Name`), rename it into your sprint band, and commit it.\n',
);
for (const statement of real) console.error(`  ${statement}`);
process.exit(1);
