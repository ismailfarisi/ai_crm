import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { APP_ROUTES, appRedirects } from './app-routes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const webApp = join(here, '../web/src/app');
const ownApp = join(here, 'src/app');

const dirs = (path) =>
  readdirSync(path, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

/** Top-level URL segments of a Next app dir, looking through (route groups). */
function topLevelRoutes(appDir) {
  return dirs(appDir).flatMap((name) =>
    name.startsWith('(') ? dirs(join(appDir, name)) : [name],
  );
}

test('every top-level route of the CRM is redirected', () => {
  const missing = topLevelRoutes(webApp).filter((r) => !APP_ROUTES.includes(r));
  assert.deepEqual(missing, [], `add these to app-routes.mjs: ${missing.join(', ')}`);
});

test('no marketing page shares a path with the CRM', () => {
  const clashes = topLevelRoutes(ownApp).filter((r) => APP_ROUTES.includes(r));
  assert.deepEqual(clashes, [], `these paths would redirect away: ${clashes.join(', ')}`);
});

test('redirects keep the path and drop a trailing slash on the app URL', () => {
  const quote = appRedirects('https://app.example.com/').find((r) => r.source.startsWith('/q/'));
  assert.deepEqual(quote, {
    source: '/q/:path*',
    destination: 'https://app.example.com/q/:path*',
    permanent: false,
  });
});
