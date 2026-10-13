// Contract: report pin failures for the toolchain files.
// Inputs are file text and lock package records.
// Outputs are failure strings. An empty list means the pin holds.
// The check does not read the disk and does not use the network.
// The patched esbuild release is 0.25.0.
// GHSA-67mh-4wv8-2f99 lists versions at or below 0.24.2.

export const SETUP_NODE_SHA = 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020';
export const NODE_VERSION_VALUE = "'>=22.17.0 <23.0.0'";
export const ESBUILD_FIX = [0, 25, 0] as const;
export const DRIZZLE_KIT_VERSION = '1.0.0-beta.1';
export const DRIZZLE_KIT_RESOLVED =
  'https://registry.npmjs.org/drizzle-kit/-/drizzle-kit-1.0.0-beta.1.tgz';
export const DRIZZLE_KIT_INTEGRITY =
  'sha512-jnbxiBeHcsVhBEyxm+MHMQTJcUGXf+JlK5RSPEw1WJeQXH4m+ETBmNXNiGNZhmT6ZPyeH7fdmsXJV+z4UiEK0Q==';
export const ALLOWED_INSTALL_SCRIPTS = {
  'better-sqlite3@13.0.3': true,
  'esbuild@0.25.12': true,
  'esbuild@0.28.2': true,
} as const;

export type LockPackage = {
  version?: string;
  resolved?: string;
  integrity?: string;
  hasInstallScript?: boolean;
  devDependencies?: Record<string, string>;
  engines?: { node?: string };
};

function codeLines(text: string): string[] {
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const hashAt = line.indexOf(' #');
    lines.push(hashAt >= 0 ? line.slice(0, hashAt) : line);
  }
  return lines;
}

export function setupNodePinFailures(text: string): string[] {
  const lines = codeLines(text);
  const failures: string[] = [];
  const uses: string[] = [];
  const versions: Array<string | null> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const usesMatch = /^\s*(?:-\s*)?uses:\s+(\S+)\s*$/.exec(line);
    if (usesMatch !== null && (usesMatch[1] ?? '').startsWith('actions/setup-node@')) {
      uses.push(usesMatch[1] ?? '');
      let nodeVersion: string | null = null;
      for (let next = index + 1; next < lines.length; next += 1) {
        const follow = lines[next] ?? '';
        if (/^\s*- /.test(follow)) {
          break;
        }
        const versionMatch = /^\s*node-version:\s*(.*)$/.exec(follow);
        if (versionMatch !== null) {
          nodeVersion = (versionMatch[1] ?? '').trim();
          break;
        }
      }
      versions.push(nodeVersion);
    }
    const anyVersion = /^\s*node-version:\s*(.*)$/.exec(line);
    if (anyVersion !== null && (anyVersion[1] ?? '').trim() !== NODE_VERSION_VALUE) {
      failures.push(`bad-node-version:${(anyVersion[1] ?? '').trim()}`);
    }
  }
  if (uses.length !== 3) {
    failures.push(`setup-node-count:${uses.length}`);
  }
  for (const action of uses) {
    if (action !== SETUP_NODE_SHA) {
      failures.push(`setup-node-uses:${action}`);
    }
  }
  const versionText = versions.map((version) => version ?? '').join(',');
  if (versions.length !== 3 || versions.some((version) => version !== NODE_VERSION_VALUE)) {
    failures.push(`node-version-set:${versionText}`);
  }
  return failures;
}

function numericParts(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match === null) {
    return null;
  }
  const raw = [match[1] ?? '', match[2] ?? '', match[3] ?? ''];
  for (const part of raw) {
    if (part.length > 1 && part.startsWith('0')) {
      return null;
    }
  }
  return [Number(raw[0]), Number(raw[1]), Number(raw[2])];
}

// True when the version is below the patched esbuild release 0.25.0.
// A version that is not three plain numbers is too old.
export function esbuildVersionBelowFix(version: string): boolean {
  const parts = numericParts(version);
  if (parts === null) {
    return true;
  }
  for (let index = 0; index < ESBUILD_FIX.length; index += 1) {
    const part = parts[index] ?? 0;
    const limit = ESBUILD_FIX[index] ?? 0;
    if (part !== limit) {
      return part < limit;
    }
  }
  return false;
}

function isEsbuildPackagePath(packagePath: string): boolean {
  return packagePath.endsWith('/esbuild') || packagePath.includes('/@esbuild/');
}

function resolvedBindsVersion(resolved: string | undefined, version: string): boolean {
  if (resolved === undefined || version === '') {
    return false;
  }
  return resolved.startsWith('https://registry.npmjs.org/') && resolved.endsWith(`-${version}.tgz`);
}

export function vulnerableEsbuildPaths(packages: Record<string, LockPackage>): string[] {
  const failures: string[] = [];
  for (const [packagePath, entry] of Object.entries(packages)) {
    if (!isEsbuildPackagePath(packagePath)) {
      continue;
    }
    const version = entry.version ?? '';
    if (esbuildVersionBelowFix(version)) {
      failures.push(`${packagePath}@${version}`);
      continue;
    }
    if (!resolvedBindsVersion(entry.resolved, version)) {
      failures.push(`${packagePath}:resolved`);
    }
    if (!(entry.integrity ?? '').startsWith('sha512-')) {
      failures.push(`${packagePath}:integrity`);
    }
  }
  return failures;
}

export function drizzleKitPinFailures(packages: Record<string, LockPackage>): string[] {
  const failures: string[] = [];
  const paths = Object.keys(packages).filter((packagePath) => packagePath.endsWith('/drizzle-kit'));
  if (paths.length !== 1 || paths[0] !== 'node_modules/drizzle-kit') {
    failures.push(`drizzle-kit-paths:${paths.join(',')}`);
  }
  const entry = packages['node_modules/drizzle-kit'];
  if (entry?.version !== DRIZZLE_KIT_VERSION) {
    failures.push('drizzle-kit-version');
  }
  if (entry?.resolved !== DRIZZLE_KIT_RESOLVED) {
    failures.push('drizzle-kit-resolved');
  }
  if (entry?.integrity !== DRIZZLE_KIT_INTEGRITY) {
    failures.push('drizzle-kit-integrity');
  }
  if (entry?.hasInstallScript === true) {
    failures.push('drizzle-kit-install-script');
  }
  return failures;
}

export function installScriptApprovalFailures(
  allowScripts: Record<string, boolean> | undefined,
): string[] {
  const value = allowScripts ?? {};
  const failures: string[] = [];
  const expectedKeys = Object.keys(ALLOWED_INSTALL_SCRIPTS);
  const actualKeys = Object.keys(value).sort();
  const wantedKeys = [...expectedKeys].sort();
  if (actualKeys.join('\n') !== wantedKeys.join('\n')) {
    failures.push(`allow-scripts-keys:${actualKeys.join(',')}`);
  }
  for (const key of expectedKeys) {
    if (value[key] !== true) {
      failures.push(`allow-scripts-value:${key}`);
    }
  }
  for (const key of Object.keys(value)) {
    if (!key.includes('@')) {
      failures.push(`allow-scripts-unpinned:${key}`);
    }
  }
  return failures;
}

export function forbiddenLockText(text: string): string[] {
  const failures: string[] = [];
  if (text.includes('@esbuild-kit')) {
    failures.push('@esbuild-kit');
  }
  if (text.includes('esbuild-0.18.20')) {
    failures.push('esbuild-0.18.20');
  }
  if (text.includes('esbuild@0.18.20')) {
    failures.push('esbuild@0.18.20');
  }
  return failures;
}
