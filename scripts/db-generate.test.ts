import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { dbGenerateCommand } from './db-generate.mjs';

// Contract: db:generate exits 0 and does not change migration files.
// The runner sets TSX_DISABLE_CACHE so the kit skips its temp cache.
// The test reads local files and runs the local kit.
// The test does not use the network.

const root = path.resolve(import.meta.dirname, '..');
const NO_SCHEMA_CHANGE = 'No schema changes, nothing to migrate';
const ORM_MISMATCH = 'Please install latest version of drizzle-orm';
const MIGRATION_TREES = ['drizzle'];
const KIT_BIN = path.join(root, 'node_modules', 'drizzle-kit', 'bin.cjs');

function collectFileHashes(dir: string, relativeDir: string, hashes: Map<string, string>): void {
  for (const name of readdirSync(dir)) {
    const absolute = path.join(dir, name);
    const relative = `${relativeDir}/${name}`;
    const info = lstatSync(absolute);
    if (info.isSymbolicLink()) {
      hashes.set(relative, `symlink:${readlinkSync(absolute)}`);
      continue;
    }
    if (info.isDirectory()) {
      collectFileHashes(absolute, relative, hashes);
      continue;
    }
    const bytes = readFileSync(absolute);
    hashes.set(relative, createHash('sha256').update(bytes).digest('hex'));
  }
}

function migrationFileHashes(): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const tree of MIGRATION_TREES) {
    collectFileHashes(path.join(root, tree), tree, hashes);
  }
  return hashes;
}

function countText(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function sortedHashLines(hashes: Map<string, string>): string[] {
  return [...hashes.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, hash]) => `${file} ${hash}`);
}

describe('db generate', { timeout: 120_000 }, () => {
  it('runs drizzle-kit through the cache-safe runner', () => {
    const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.['db:generate:sqlite']).toBe('node scripts/db-generate.mjs sqlite');
    expect(packageJson.scripts?.['db:generate:pg']).toBe('node scripts/db-generate.mjs pg');
    expect(packageJson.scripts?.['db:generate']).toBe(
      'npm run db:generate:sqlite && npm run db:generate:pg',
    );
  });

  it('builds a fixed drizzle-kit command for sqlite and pg', () => {
    expect(dbGenerateCommand('sqlite')).toEqual({
      program: process.execPath,
      args: [KIT_BIN, 'generate', '--config', 'drizzle.sqlite.config.ts'],
      env: { TSX_DISABLE_CACHE: '1' },
    });
    expect(dbGenerateCommand('pg')).toEqual({
      program: process.execPath,
      args: [KIT_BIN, 'generate', '--config', 'drizzle.pg.config.ts'],
      env: { TSX_DISABLE_CACHE: '1' },
    });
  });

  it('rejects a config name that is not sqlite or pg', () => {
    for (const configName of ['', 'constructor', '__proto__', 'toString', 'sqlite ', 'pg\n']) {
      expect(dbGenerateCommand(configName)).toBeNull();
    }
    fc.assert(
      fc.property(fc.string(), (configName) => {
        if (configName === 'sqlite' || configName === 'pg') {
          expect(dbGenerateCommand(configName)).not.toBeNull();
          return;
        }
        expect(dbGenerateCommand(configName)).toBeNull();
      }),
      { seed: 10131353, numRuns: 100 },
    );
  });

  it('does not write the tsx temp cache', () => {
    const tempRoot = path.join(tmpdir(), 'srep-db-generate-cache-check');
    rmSync(tempRoot, { recursive: true, force: true });
    mkdirSync(tempRoot);
    const result = spawnSync('npm', ['run', 'db:generate'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 90_000,
      env: { ...process.env, TMPDIR: tempRoot, TMP: tempRoot, TEMP: tempRoot },
    });
    const wroteCache = readdirSync(tempRoot).some((name) => name.startsWith('tsx-'));
    rmSync(tempRoot, { recursive: true, force: true });
    expect(result.status).toBe(0);
    expect(wroteCache).toBe(false);
  });

  it('exits 0 and leaves the migration files unchanged', () => {
    const before = migrationFileHashes();
    expect(before.has('drizzle/sqlite/meta/_journal.json')).toBe(true);
    expect(before.has('drizzle/pg/meta/_journal.json')).toBe(true);
    const result = spawnSync('npm', ['run', 'db:generate'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 90_000,
    });
    const after = migrationFileHashes();
    const stdout = result.stdout ?? '';
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(countText(stdout, NO_SCHEMA_CHANGE)).toBe(2);
    expect(stdout).toContain('drizzle.sqlite.config.ts');
    expect(stdout).toContain('drizzle.pg.config.ts');
    expect(result.stderr ?? '').not.toContain(ORM_MISMATCH);
    expect(sortedHashLines(after)).toEqual(sortedHashLines(before));
  });
});
