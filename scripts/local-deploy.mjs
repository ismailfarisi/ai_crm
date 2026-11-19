#!/usr/bin/env node
/**
 * One-command local deployment behind a Cloudflare tunnel.
 *
 *   pnpm local:deploy                 # quick tunnel, random *.trycloudflare.com URL
 *   node scripts/local-deploy.mjs     # same, when pnpm isn't on PATH (uses corepack)
 *   pnpm local:deploy --seed          # ...and load the demo tenant (first run)
 *   pnpm local:deploy --skip-build    # reuse the last build
 *
 * Stable hostname: create a tunnel in the Cloudflare dashboard (Zero Trust →
 * Networks → Tunnels), add a public hostname pointing at http://localhost:8080,
 * then run with CLOUDFLARE_TUNNEL_TOKEN=<token> LOCAL_PUBLIC_URL=https://<host>.
 *
 * Layout — everything is served from one origin, so cookies and CORS behave
 * exactly as they would on a single domain:
 *
 *   browser → Cloudflare → cloudflared → router :8080 ─┬─ /api/* → API :4000
 *                                                      └─ else   → web :3000
 *   worker (Temporal) · postgres/redis/temporal in docker compose
 *
 * The web app is built with NEXT_PUBLIC_API_URL=/api/v1 (resolved against the
 * page's origin), so the same build works under any tunnel URL.
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'apps', 'api');
const webDir = path.join(root, 'apps', 'web');

const args = new Set(process.argv.slice(2));
const flags = {
  seed: args.has('--seed'),
  skipBuild: args.has('--skip-build'),
  install: args.has('--install'),
};

const ROUTER_PORT = Number(process.env.LOCAL_ROUTER_PORT ?? 8080);
const API_PORT = Number(process.env.LOCAL_API_PORT ?? 4000);
const WEB_PORT = Number(process.env.LOCAL_WEB_PORT ?? 3000);
const TUNNEL_TOKEN = process.env.CLOUDFLARE_TUNNEL_TOKEN;
const isWindows = process.platform === 'win32';

const children = [];
let shuttingDown = false;

const log = (msg) => console.log(`\x1b[36m[deploy]\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\x1b[31m[deploy]\x1b[0m ${msg}`);
  shutdown(1);
};

/**
 * Windows needs a shell to run `.cmd` shims (pnpm, corepack); passing an
 * args array alongside `shell: true` is deprecated, so hand it one string.
 */
const spawnArgs = (cmd, cmdArgs) =>
  isWindows
    ? [[cmd, ...cmdArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(' '), []]
    : [cmd, cmdArgs];

/** Runs a command to completion, streaming its output; exits on failure. */
function run(cmd, cmdArgs, opts = {}) {
  log(`$ ${cmd} ${cmdArgs.join(' ')}`);
  const result = spawnSync(...spawnArgs(cmd, cmdArgs), {
    cwd: root,
    stdio: 'inherit',
    shell: isWindows,
    ...opts,
    env: { ...process.env, ...opts.env },
  });
  if (result.status !== 0) fail(`${cmd} ${cmdArgs.join(' ')} failed (exit ${result.status}).`);
}

function has(cmd) {
  const probe = spawnSync(...spawnArgs(cmd, ['--version']), { stdio: 'ignore', shell: isWindows });
  return probe.status === 0;
}

/**
 * Without `corepack enable` there is no `pnpm` on PATH — and the package
 * scripts call pnpm themselves — so put a corepack-backed shim on PATH for
 * this process and everything it starts.
 */
function ensurePnpm() {
  if (has('pnpm')) return;
  if (!has('corepack')) fail('pnpm is not installed and corepack is unavailable (Node >= 22 ships it).');
  const dir = path.join(os.tmpdir(), 'kerf-local-deploy-bin');
  mkdirSync(dir, { recursive: true });
  if (isWindows) {
    writeFileSync(path.join(dir, 'pnpm.cmd'), '@corepack pnpm %*\r\n');
  } else {
    writeFileSync(path.join(dir, 'pnpm'), '#!/bin/sh\nexec corepack pnpm "$@"\n', { mode: 0o755 });
  }
  process.env.PATH = dir + path.delimiter + process.env.PATH;
  log('pnpm not on PATH — using it through corepack.');
}

/** Starts a long-running process with prefixed output. */
function start(name, color, cmd, cmdArgs, opts = {}) {
  const child = spawn(...spawnArgs(cmd, cmdArgs), {
    cwd: root,
    shell: isWindows,
    ...opts,
    env: { ...process.env, ...opts.env },
  });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buffered = '';
    stream.on('data', (chunk) => {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop();
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (!shuttingDown) fail(`${name} exited unexpectedly (code ${code}).`);
  });
  children.push(child);
  return child;
}

/** Synchronous on purpose: `fail()` relies on it never returning. */
function shutdown(code = 0) {
  if (!shuttingDown) {
    shuttingDown = true;
    const running = children.filter((child) => child.exitCode === null && child.pid);
    if (running.length) {
      log('Stopping app processes (docker services keep running — `pnpm db:down` stops them)…');
    }
    for (const child of running) {
      // With shell: true the pid is the shell, so kill the whole tree.
      if (isWindows) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill('SIGTERM');
    }
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '0.0.0.0');
  });
}

async function waitFor(label, check, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(`Timed out waiting for ${label}.`);
}

const httpOk = (url) =>
  new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => req.destroy());
  });

/**
 * Same-origin router in front of the API and web servers. Streams both ways,
 * so SSE (the assistant stream) and uploads pass through untouched.
 */
function startRouter() {
  const server = http.createServer((req, res) => {
    const toApi = req.url === '/api' || req.url.startsWith('/api/');
    const headers = { ...req.headers };
    // cloudflared hands us the real client IP; make it the only XFF entry so
    // the API (TRUST_PROXY_HOPS=1, trusting this router) rate-limits per visitor.
    if (headers['cf-connecting-ip']) headers['x-forwarded-for'] = headers['cf-connecting-ip'];
    headers['x-forwarded-proto'] ??= 'https';
    headers['x-forwarded-host'] ??= req.headers.host;

    const upstream = http.request(
      { host: '127.0.0.1', port: toApi ? API_PORT : WEB_PORT, method: req.method, path: req.url, headers },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        upRes.pipe(res);
      },
    );
    upstream.on('error', (err) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`Upstream ${toApi ? 'API' : 'web'} unavailable: ${err.message}`);
    });
    req.pipe(upstream);
  });
  // Long-lived SSE connections must not be cut by Node's default timeouts.
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.keepAliveTimeout = 65_000;
  server.listen(ROUTER_PORT, '127.0.0.1');
  return new Promise((resolve) => server.once('listening', resolve));
}

/** Starts cloudflared and resolves with the public URL. */
function startTunnel() {
  if (TUNNEL_TOKEN) {
    const url = process.env.LOCAL_PUBLIC_URL?.replace(/\/$/, '');
    if (!url) fail('CLOUDFLARE_TUNNEL_TOKEN needs LOCAL_PUBLIC_URL (e.g. https://local.example.com).');
    start('tunnel', '35', 'cloudflared', ['tunnel', '--no-autoupdate', 'run', '--token', TUNNEL_TOKEN]);
    return Promise.resolve(url);
  }

  return new Promise((resolve) => {
    const child = start('tunnel', '35', 'cloudflared', [
      'tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${ROUTER_PORT}`,
    ]);
    const timer = setTimeout(() => fail('cloudflared did not report a tunnel URL within 60s.'), 60_000);
    const onData = (chunk) => {
      const match = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timer);
        child.stderr.off('data', onData);
        resolve(match[0]);
      }
    };
    child.stderr.on('data', onData);
  });
}

async function main() {
  // ── Preflight ──────────────────────────────────────────────────────────────
  ensurePnpm();
  if (!has('docker')) fail('Docker is not installed or not on PATH. Install Docker Desktop and start it.');
  if (spawnSync(...spawnArgs('docker', ['info']), { stdio: 'ignore', shell: isWindows }).status !== 0) {
    fail('Docker is installed but the daemon is not running. Start Docker Desktop and retry.');
  }
  if (!has('cloudflared')) fail('cloudflared is not installed (winget install Cloudflare.cloudflared).');

  for (const port of [ROUTER_PORT, API_PORT, WEB_PORT]) {
    if (!(await portFree(port))) fail(`Port ${port} is already in use — stop whatever holds it (pnpm dev?).`);
  }

  for (const [example, target] of [
    ['.env.example', '.env'],
    ['apps/api/.env.example', 'apps/api/.env'],
  ]) {
    if (!existsSync(path.join(root, target))) {
      copyFileSync(path.join(root, example), path.join(root, target));
      log(`Created ${target} from ${example}.`);
    }
  }

  // ── Infrastructure ─────────────────────────────────────────────────────────
  if (flags.install || !existsSync(path.join(root, 'node_modules'))) run('pnpm', ['install']);
  run('docker', ['compose', 'up', '-d', '--wait', 'postgres', 'redis', 'temporal']);

  // ── Build ──────────────────────────────────────────────────────────────────
  const webEnv = {
    NEXT_PUBLIC_API_URL: '/api/v1',
    API_INTERNAL_URL: `http://127.0.0.1:${API_PORT}/api/v1`,
  };
  if (!flags.skipBuild || !existsSync(path.join(webDir, '.next', 'BUILD_ID'))) {
    run('pnpm', ['--filter', '@saas/shared', 'build']);
    run('pnpm', ['--filter', 'api', 'build']);
    run('pnpm', ['--filter', 'web', 'build'], { env: webEnv });
  }

  run('pnpm', ['migration:run']);
  if (flags.seed) run('pnpm', ['seed']);

  // ── Tunnel first: the API needs to know its public URL at boot ─────────────
  await startRouter();
  log(`Router listening on http://127.0.0.1:${ROUTER_PORT}`);
  const publicUrl = await startTunnel();
  log(`Tunnel up: ${publicUrl}`);

  const apiEnv = {
    PORT: String(API_PORT),
    PUBLIC_WEB_URL: publicUrl,
    PUBLIC_API_URL: `${publicUrl}/api/v1`,
    WEB_ORIGIN: [publicUrl, `http://localhost:${ROUTER_PORT}`, `http://localhost:${WEB_PORT}`].join(','),
    COOKIE_SECURE: 'true',
    TRUST_PROXY_HOPS: '1',
  };

  start('api', '32', 'node', ['dist/main'], { cwd: apiDir, env: apiEnv });
  start('worker', '33', 'node', ['dist/temporal-worker.js'], { cwd: apiDir, env: apiEnv });
  start('web', '34', 'pnpm', ['exec', 'next', 'start', '-p', String(WEB_PORT), '-H', '127.0.0.1'], {
    cwd: webDir,
    env: webEnv,
  });

  await waitFor('API', () => httpOk(`http://127.0.0.1:${API_PORT}/api/v1/health`));
  await waitFor('web', () => httpOk(`http://127.0.0.1:${WEB_PORT}/login`));

  console.log(`
\x1b[32m✔ Kerf is live\x1b[0m
  Public:  ${publicUrl}
  Local:   http://localhost:${ROUTER_PORT}
  Login:   owner@northwind.test / Password123!  (after a --seed run)
  Temporal UI: http://localhost:8233

A fresh trycloudflare.com hostname can take ~15s to resolve.
Ctrl+C stops the app; postgres/redis/temporal keep running (pnpm db:down).
`);
}

main().catch((err) => fail(err?.stack ?? String(err)));
