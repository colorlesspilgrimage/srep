#!/usr/bin/env node
/**
 * Ensure sqlx migration SQL matches the archived Drizzle snapshot (pre-cutover parity).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const PAIRS = [
  ['legacy/v1-sveltekit/drizzle/sqlite', 'migrations/sqlite'],
  ['legacy/v1-sveltekit/drizzle/pg', 'migrations/postgres'],
];

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function sqlFiles(dir) {
  const abs = path.join(root, dir);
  return readdirSync(abs)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

let failed = false;

for (const [drizzleDir, migrationsDir] of PAIRS) {
  const drizzle = sqlFiles(drizzleDir);
  const migrations = sqlFiles(migrationsDir);
  if (drizzle.join() !== migrations.join()) {
    console.error(`[${drizzleDir}] file list mismatch:`);
    console.error(`  drizzle:     ${drizzle.join(', ')}`);
    console.error(`  migrations:  ${migrations.join(', ')}`);
    failed = true;
    continue;
  }
  for (const file of drizzle) {
    const a = path.join(root, drizzleDir, file);
    const b = path.join(root, migrationsDir, file);
    if (!statSync(b).isFile()) {
      console.error(`missing migration file: ${migrationsDir}/${file}`);
      failed = true;
      continue;
    }
    if (sha256(a) !== sha256(b)) {
      console.error(`content mismatch: ${file} (${drizzleDir} vs ${migrationsDir})`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}
console.log('migrations/sqlite and migrations/postgres match legacy Drizzle SQL snapshots');
