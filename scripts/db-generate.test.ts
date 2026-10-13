import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Contract: db:generate exits 0 and does not change migration files.
// The test reads local files and runs the local kit.
// The test does not use the network.

const root = path.resolve(import.meta.dirname, '..');
const NO_SCHEMA_CHANGE = 'No schema changes, nothing to migrate';
const MIGRATION_TREES = ['drizzle/sqlite', 'drizzle/pg'];

function collectFileHashes(dir: string, relativeDir: string, hashes: Map<string, string>): void {
  for (const name of readdirSync(dir)) {
    const absolute = path.join(dir, name);
    const relative = `${relativeDir}/${name}`;
    if (statSync(absolute).isDirectory()) {
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
  it('exits 0 and leaves the migration files unchanged', () => {
    const before = migrationFileHashes();
    const result = spawnSync('npm', ['run', 'db:generate'], {
      cwd: root,
      encoding: 'utf8',
    });
    const after = migrationFileHashes();
    expect(result.status).toBe(0);
    expect(countText(result.stdout ?? '', NO_SCHEMA_CHANGE)).toBe(2);
    expect(sortedHashLines(after)).toEqual(sortedHashLines(before));
  });
});
