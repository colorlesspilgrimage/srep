import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Contract: read the pin files from disk and assert their text.
// Inputs are package.json, package-lock.json, ci.yml, and the drizzle files.
// The test does not import the app and does not use the network.

const root = path.resolve(import.meta.dirname, '..');

const NODE_RANGE = "node-version: '>=22.17.0 <23.0.0'";
const SETUP_NODE_SHA = 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020';
const ESBUILD_LIMIT = [0, 24, 2] as const;

type PackageJson = {
  engines?: { node?: string };
  devDependencies?: { 'drizzle-kit'?: string };
  allowScripts?: Record<string, boolean>;
};

type LockPackage = {
  version?: string;
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

function countText(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function numericParts(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (match === null) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// True when major.minor.patch is less than or equal to 0.24.2.
// A version with no three-part number is treated as too old.
function esbuildAtMostLimit(version: string): boolean {
  const parts = numericParts(version);
  if (parts === null) {
    return true;
  }
  const major = parts[0];
  const minor = parts[1];
  const patch = parts[2];
  if (major !== ESBUILD_LIMIT[0]) {
    return major < ESBUILD_LIMIT[0];
  }
  if (minor !== ESBUILD_LIMIT[1]) {
    return minor < ESBUILD_LIMIT[1];
  }
  return patch <= ESBUILD_LIMIT[2];
}

function oldEsbuildPaths(packages: Record<string, LockPackage>): string[] {
  const failures: string[] = [];
  for (const [packagePath, entry] of Object.entries(packages)) {
    if (!packagePath.endsWith('/esbuild')) {
      continue;
    }
    const version = entry.version ?? '';
    if (esbuildAtMostLimit(version)) {
      failures.push(`${packagePath}@${version}`);
    }
  }
  return failures;
}

describe('toolchain pins', () => {
  const packageJson = readJson<PackageJson>('package.json');
  const lock = readJson<LockFile>('package-lock.json');
  const packages = lock.packages ?? {};
  const workflow = readText('.github/workflows/ci.yml');

  it('sets engines.node to >=22.17', () => {
    expect(packageJson.engines?.node).toBe('>=22.17');
  });

  it('pins drizzle-kit to the exact text 1.0.0-beta.1', () => {
    expect(packageJson.devDependencies?.['drizzle-kit']).toBe('1.0.0-beta.1');
  });

  it('does not allow the esbuild 0.18.20 install script', () => {
    expect(packageJson.allowScripts ?? {}).not.toHaveProperty('esbuild@0.18.20');
  });

  it('locks node_modules/drizzle-kit at 1.0.0-beta.1', () => {
    expect(packages['node_modules/drizzle-kit']?.version).toBe('1.0.0-beta.1');
  });

  it('has no lock path that contains @esbuild-kit', () => {
    const hit = Object.keys(packages).find((packagePath) => packagePath.includes('@esbuild-kit'));
    expect(hit).toBeUndefined();
  });

  it('rejects an esbuild package at version 0.24.2 or lower', () => {
    expect(oldEsbuildPaths(packages)).toEqual([]);
  });

  it('asks setup-node for the Node 22.17 range on three jobs', () => {
    expect(countText(workflow, NODE_RANGE)).toBe(3);
  });

  it('keeps the setup-node action SHA on three jobs', () => {
    expect(countText(workflow, SETUP_NODE_SHA)).toBe(3);
  });

  it('does not contain the line node-version: 22', () => {
    const bare = workflow.split('\n').filter((line) => line.trim() === 'node-version: 22');
    expect(bare).toEqual([]);
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
