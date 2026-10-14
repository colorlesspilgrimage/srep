import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DRIZZLE_KIT_VERSION,
  ESBUILD_OVERRIDE,
  type LockPackage,
  drizzleKitPinFailures,
  esbuildOverrideFailures,
  forbiddenLockText,
  installScriptApprovalFailures,
  setupNodePinFailures,
  vulnerableEsbuildPaths,
} from './toolchain-pin-check.js';

// Contract: read the pin files from disk and assert their text.
// Inputs are package.json, package-lock.json, ci.yml, and the drizzle files.
// The test reads local files only.

const root = path.resolve(import.meta.dirname, '..');

type PackageJson = {
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  allowScripts?: Record<string, boolean>;
  overrides?: Record<string, string>;
};

type LockFile = {
  packages?: Record<string, LockPackage>;
};

function readText(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readText(relativePath)) as T;
}

describe('toolchain pins', () => {
  const packageJson = readJson<PackageJson>('package.json');
  const lockText = readText('package-lock.json');
  const lock = JSON.parse(lockText) as LockFile;
  const packages = lock.packages ?? {};
  const workflow = readText('.github/workflows/ci.yml');

  it('sets engines.node to >=22.17', () => {
    expect(packageJson.engines?.node).toBe('>=22.17');
    expect(packages['']?.engines?.node).toBe('>=22.17');
  });

  it('pins drizzle-kit to the exact text 0.31.11', () => {
    expect(packageJson.devDependencies?.['drizzle-kit']).toBe(DRIZZLE_KIT_VERSION);
    expect(packageJson.devDependencies?.['drizzle-kit']).toBe('0.31.11');
    expect(packageJson.dependencies?.['drizzle-kit']).toBeUndefined();
    expect(packages['']?.devDependencies?.['drizzle-kit']).toBe(DRIZZLE_KIT_VERSION);
  });

  it('sets overrides.esbuild to $esbuild and no other key', () => {
    expect(packageJson.overrides).toEqual({ esbuild: ESBUILD_OVERRIDE });
    expect(Object.keys(packageJson.overrides ?? {})).toEqual(['esbuild']);
  });

  it('accepts the package.json esbuild override', () => {
    expect(esbuildOverrideFailures(packageJson.overrides)).toEqual([]);
  });

  it('allows install scripts only for the reviewed package versions', () => {
    expect(installScriptApprovalFailures(packageJson.allowScripts)).toEqual([]);
  });

  it('locks drizzle-kit to the registry tarball', () => {
    expect(drizzleKitPinFailures(packages)).toEqual([]);
  });

  it('has no lock text for the old esbuild kit chain', () => {
    expect(forbiddenLockText(lockText)).toEqual([]);
  });

  it('rejects an esbuild package below the patched release', () => {
    expect(vulnerableEsbuildPaths(packages)).toEqual([]);
  });

  it('asks setup-node for the Node 22.17 range on three jobs', () => {
    expect(setupNodePinFailures(workflow)).toEqual([]);
  });

  it('does not add a .nvmrc file', () => {
    expect(existsSync(path.join(root, '.nvmrc'))).toBe(false);
  });

  it('keeps the sqlite migration journal', () => {
    expect(existsSync(path.join(root, 'drizzle/sqlite/meta/_journal.json'))).toBe(true);
  });

  it('keeps the postgres migration journal', () => {
    expect(existsSync(path.join(root, 'drizzle/pg/meta/_journal.json'))).toBe(true);
  });

  it('keeps the sqlite drizzle dialect', () => {
    expect(readText('drizzle.sqlite.config.ts')).toContain("dialect: 'sqlite'");
  });

  it('keeps the postgres drizzle dialect', () => {
    expect(readText('drizzle.pg.config.ts')).toContain("dialect: 'postgresql'");
  });
});
