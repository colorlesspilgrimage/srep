#!/usr/bin/env tsx
// Prints import dry-run warnings for each .apkg path argument. Not run in CI.
import fs from 'node:fs/promises';
import { planApkgImport } from '../src/lib/server/import-export/apkg/import.js';
import { getSnapshotStore } from '../src/lib/server/import-export/snapshot-store.js';
import { createDomainHarness } from '../src/lib/server/domain/test-support/harness.js';

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('Usage: tsx scripts/apkg-corpus-smoke.ts <file.apkg> [...]');
  process.exit(2);
}

const harness = await createDomainHarness();
const deps = {
  snapshot: getSnapshotStore(harness.handle),
  domain: harness.deps,
  now: () => harness.clock.now,
  importMaxBytes: 500_000_000,
};

for (const file of paths) {
  const bytes = await fs.readFile(file);
  const report = await planApkgImport(deps, bytes);
  console.log(file);
  if ('error' in report) {
    console.log('  error:', report.error);
    continue;
  }
  console.log('  notes:', report.wouldImport.notes);
  for (const warning of report.warnings) {
    console.log('  warn:', warning);
  }
}

await harness.close();
