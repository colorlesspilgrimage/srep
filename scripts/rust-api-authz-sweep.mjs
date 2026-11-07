#!/usr/bin/env node
/**
 * Guest requests to non-public /api routes must receive 401 (mirrors scripts/api-authz-sweep.test.ts).
 */
import { spawn } from 'node:child_process';
import { accessSync, constants, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const PUBLIC = new Set(
  [
    ['GET', '/api/auth/status'],
    ['POST', '/api/auth/setup/options'],
    ['POST', '/api/auth/setup/verify'],
    ['POST', '/api/auth/login/options'],
    ['POST', '/api/auth/login/verify'],
    ['POST', '/api/auth/recovery/login'],
    ['POST', '/api/auth/pairing/exchange'],
  ].map(([m, p]) => `${m} ${p}`),
);

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const PLACEHOLDER = '00000000-0000-0000-0000-000000000001';
const PLACEHOLDER_SHA =
  '0000000000000000000000000000000000000000000000000000000000000000';

const root = path.resolve(import.meta.dirname, '..');
const cratesDir = path.join(root, 'crates');

function walk(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) {
      walk(full, out);
    } else if (name.name.endsWith('.rs')) {
      out.push(full);
    }
  }
  return out;
}

function expandPath(routePath) {
  return routePath
    .replace(':id', PLACEHOLDER)
    .replace(':sha', PLACEHOLDER_SHA);
}

function collectRoutes() {
  const routes = new Set();
  const re = /\.route\(\s*"([^"]+)"/g;
  for (const file of walk(cratesDir)) {
    const text = readFileSync(file, 'utf8');
    let match;
    while ((match = re.exec(text)) !== null) {
      const p = match[1];
      if (p.startsWith('/api')) {
        routes.add(p);
      }
    }
  }
  routes.add('/api');
  return [...routes].sort();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serverBinary() {
  const release = path.join(root, 'target/release/srep-server');
  const debug = path.join(root, 'target/debug/srep-server');
  for (const candidate of [release, debug]) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function waitForHealth(baseUrl, attempts = 120) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) {
        return;
      }
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  throw new Error('server did not become healthy');
}

async function main() {
  const baseUrl = process.env.SREP_AUTHZ_BASE_URL ?? 'http://localhost:3099';
  const ownServer = !process.env.SREP_AUTHZ_BASE_URL;
  let child;
  if (ownServer) {
    const bin = serverBinary();
    if (!bin) {
      throw new Error('build srep-server first (cargo build -p srep-server)');
    }
    const dbPath = '/tmp/srep-authz-sweep.db';
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        rmSync(`${dbPath}${suffix}`, { force: true });
      } catch {
        /* ignore */
      }
    }
    child = spawn(
      bin,
      [],
      {
        cwd: root,
        env: {
          ...process.env,
          PORT: '3099',
          HOST: '0.0.0.0',
          SREP_DATABASE_URL: `sqlite:${dbPath}`,
          SREP_ORIGIN: baseUrl,
          SREP_RP_ID: 'localhost',
          SREP_MEDIA_DIR: '/tmp/srep-authz-media',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let childExited = false;
    child.on('exit', (code) => {
      childExited = true;
      if (code !== null && code !== 0) {
        console.error(`srep-server exited with ${code}`);
      }
    });
    child.stderr?.on('data', (chunk) => {
      process.stderr.write(chunk);
    });
    await waitForHealth(baseUrl);
    if (childExited) {
      throw new Error('srep-server exited before becoming healthy');
    }
  }

  const routes = collectRoutes().filter((p) => !p.includes('['));
  let failed = false;
  for (const routePath of routes) {
    const pathExpanded = expandPath(routePath);
    for (const method of METHODS) {
      if (PUBLIC.has(`${method} ${routePath}`)) {
        continue;
      }
      const res = await fetch(baseUrl + pathExpanded, { method });
      if (res.status !== 401) {
        console.error(`expected 401 for guest ${method} ${pathExpanded}, got ${res.status}`);
        failed = true;
      }
    }
  }

  if (child) {
    child.kill('SIGTERM');
  }
  if (failed) {
    process.exit(1);
  }
  console.log(`authz sweep ok (${routes.length} routes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
