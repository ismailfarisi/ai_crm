#!/usr/bin/env node
/**
 * Fails when the entities and the migrated schema have drifted apart.
 *
 * CLAUDE.md has always said "`pnpm migration:generate` against a migrated DB
 * must report no drift". This turns that sentence into a check.
 *
 * It is not a plain "did it emit a file", for two reasons.
 *
 * Some drift is deliberate and permanent: foreign keys are declared in
 * migrations rather than on entities (entities carry plain uuid columns, so
 * relation metadata never drifts and FK names never churn), and CHECK
 * constraints likewise live only in migrations. Those are ignored by pattern.
 *
 * The rest is a backlog. `drift-baseline.json` records the ~100 statements
 * this schema already produced when the check was written — legacy index
 * names, enum renames, defaults that exist only on the entity. Those are
 * reported but do not fail, because a check that is red the day it lands
 * teaches everyone to ignore it. Anything *not* in the baseline fails, which
 * is what stops new drift arriving; and a baseline entry that has stopped
 * appearing is reported too, so the file shrinks as the backlog is paid down.
 *
 * Flags: `--verbose` lists the backlog, `--update-baseline` rewrites it after
 * deliberately fixing some, `--input <file>` checks a migration generated
 * elsewhere (which is also how this script is tested without a database).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'apps', 'api', 'DriftCheck');
const BASELINE = join(process.cwd(), 'scripts', 'drift-baseline.json');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const updateBaseline = args.includes('--update-baseline');
const inputFile = args[args.indexOf('--input') + 1] || null;
const hasInput = args.includes('--input') && inputFile;

/** Statements that are known, permanent, and not drift. */
const IGNORED = [
  /ALTER TABLE .* DROP CONSTRAINT "FK_/i,
  /ALTER TABLE .* ADD CONSTRAINT "FK_.*FOREIGN KEY/i,
  /ALTER TABLE .* DROP CONSTRAINT "CHK_/i,
  /ALTER TABLE .* ADD CONSTRAINT "CHK_/i,
];

/** TypeORM prints this, then exits non-zero, when there is nothing to write. */
const NO_CHANGES = 'No changes in database schema were found';

const clean = (message) => {
  console.log(message);
  process.exit(0);
};

function generate() {
  if (hasInput) return readFileSync(inputFile, 'utf8');

  let output = '';
  try {
    output = execFileSync(
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
      { encoding: 'utf8', stdio: 'pipe', shell: process.platform === 'win32' },
    );
  } catch (error) {
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    // Exactly one non-zero exit means "clean". Everything else — a database
    // that is not there, a bad data source, a build that was never run — has
    // to fail loudly: a drift check that passes when it could not look is
    // worse than no drift check at all.
    if (!output.includes(NO_CHANGES)) {
      console.error(
        'Could not check for drift. Is the database up, and `pnpm --filter api build` run?',
      );
      console.error(output.trim() || String(error));
      process.exit(1);
    }
    clean('No drift: the schema matches the entities.');
  }
  if (verbose) console.log(output);

  try {
    const generated = readFileSync(`${OUT}.ts`, 'utf8');
    rmSync(`${OUT}.ts`, { force: true });
    return generated;
  } catch {
    if (output.includes(NO_CHANGES)) {
      clean('No drift: the schema matches the entities.');
    }
    console.error('Expected a generated migration to inspect, and found none.');
    process.exit(1);
  }
}

const up = generate().split('public async down')[0];
const statements = [...up.matchAll(/await queryRunner\.query\(`([\s\S]*?)`\)/g)]
  .map((m) => m[1].replace(/\s+/g, ' ').trim())
  .filter(Boolean);

const real = [...new Set(statements.filter((s) => !IGNORED.some((re) => re.test(s))))];
const ignored = statements.length - real.length;

if (updateBaseline) {
  writeFileSync(BASELINE, `${JSON.stringify(real.sort(), null, 2)}\n`);
  clean(`Baseline updated: ${real.length} known statement(s).`);
}

let baseline = [];
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
} catch {
  console.error(`Could not read ${BASELINE}. Regenerate it with --update-baseline.`);
  process.exit(1);
}

const known = new Set(baseline);
const unexpected = real.filter((s) => !known.has(s));
const backlog = real.filter((s) => known.has(s));
const fixed = baseline.filter((s) => !real.includes(s));

console.log(
  `${ignored} statement(s) ignored by design (foreign keys, check constraints); ` +
    `${backlog.length} known and not yet fixed.`,
);
if (verbose) for (const statement of backlog) console.log(`  known: ${statement}`);
if (fixed.length) {
  console.log(
    `\n${fixed.length} baseline statement(s) no longer appear. Shrink the backlog with ` +
      '`pnpm check:drift --update-baseline`:',
  );
  for (const statement of fixed) console.log(`  fixed: ${statement}`);
}

if (unexpected.length === 0) clean('\nNo new drift.');

console.error(
  `\nSchema drift: ${unexpected.length} statement(s) the entities want that no migration has written.\n` +
    'Generate a migration (`pnpm migration:generate Name`), rename it into your sprint band, and commit it.\n',
);
for (const statement of unexpected) console.error(`  ${statement}`);
process.exit(1);
