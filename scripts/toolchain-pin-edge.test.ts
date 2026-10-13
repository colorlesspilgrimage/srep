import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_INSTALL_SCRIPTS,
  DRIZZLE_KIT_INTEGRITY,
  DRIZZLE_KIT_RESOLVED,
  DRIZZLE_KIT_VERSION,
  ESBUILD_FIX,
  SETUP_NODE_SHA,
  drizzleKitPinFailures,
  esbuildOverrideFailures,
  esbuildVersionBelowFix,
  forbiddenLockText,
  installScriptApprovalFailures,
  setupNodePinFailures,
  vulnerableEsbuildPaths,
} from './toolchain-pin-check.js';

// Contract: feed bad pin data and require a failure.
// Inputs are fixtures. The test does not read the app and does not use the network.

const COMMENT_SPOOF = [
  "# node-version: '>=22.17.0 <23.0.0'",
  "# node-version: '>=22.17.0 <23.0.0'",
  "# node-version: '>=22.17.0 <23.0.0'",
  `# ${SETUP_NODE_SHA}`,
  `# ${SETUP_NODE_SHA}`,
  `# ${SETUP_NODE_SHA}`,
  'jobs:',
  '  one:',
  '    steps:',
  '      - uses: actions/setup-node@v4',
  '        with:',
  '          node-version: 22',
].join('\n');

describe('toolchain pin edges', () => {
  it('rejects an old @esbuild platform package', () => {
    expect(
      vulnerableEsbuildPaths({
        'node_modules/@esbuild/linux-x64': { version: '0.18.20' },
      }),
    ).toEqual(['node_modules/@esbuild/linux-x64@0.18.20']);
  });

  it('rejects esbuild 0.24.2 and esbuild 0.24.3', () => {
    expect(
      vulnerableEsbuildPaths({
        'node_modules/esbuild': { version: '0.24.2' },
        'node_modules/tool/node_modules/esbuild': { version: '0.24.3' },
      }),
    ).toEqual(['node_modules/esbuild@0.24.2', 'node_modules/tool/node_modules/esbuild@0.24.3']);
  });

  it('rejects a safe version whose tarball name does not match', () => {
    expect(
      vulnerableEsbuildPaths({
        'node_modules/esbuild': {
          version: '0.25.12',
          resolved: 'https://registry.npmjs.org/esbuild/-/esbuild-0.18.20.tgz',
          integrity: 'sha512-abc',
        },
      }),
    ).toEqual(['node_modules/esbuild:resolved']);
  });

  it('ignores esbuild-register', () => {
    expect(
      vulnerableEsbuildPaths({
        'node_modules/esbuild-register': { version: '3.6.0' },
      }),
    ).toEqual([]);
  });

  it('rejects a comment copy of the Node pin', () => {
    expect(setupNodePinFailures(COMMENT_SPOOF)).toEqual([
      'bad-node-version:22',
      'setup-node-count:1',
      'setup-node-uses:actions/setup-node@v4',
      'node-version-set:22',
    ]);
  });

  it('rejects a drizzle-kit tarball with a different integrity', () => {
    expect(
      drizzleKitPinFailures({
        'node_modules/drizzle-kit': {
          version: DRIZZLE_KIT_VERSION,
          resolved: DRIZZLE_KIT_RESOLVED,
          integrity: 'sha512-different',
        },
      }),
    ).toEqual(['drizzle-kit-integrity']);
  });

  it('rejects a drizzle-kit install script', () => {
    expect(
      drizzleKitPinFailures({
        'node_modules/drizzle-kit': {
          version: DRIZZLE_KIT_VERSION,
          resolved: DRIZZLE_KIT_RESOLVED,
          integrity: DRIZZLE_KIT_INTEGRITY,
          hasInstallScript: true,
        },
      }),
    ).toEqual(['drizzle-kit-install-script']);
  });

  it('rejects lock text that names the esbuild 0.18.20 tarball', () => {
    expect(forbiddenLockText('https://registry.npmjs.org/esbuild/-/esbuild-0.18.20.tgz')).toEqual([
      'esbuild-0.18.20',
    ]);
  });

  it('allows the esbuild-kit name when the old tarball is absent', () => {
    expect(forbiddenLockText('{"dependencies":{"@esbuild-kit/esm-loader":"2.6.5"}}')).toEqual([]);
  });

  it('rejects a missing esbuild override', () => {
    expect(esbuildOverrideFailures(undefined)).toEqual(['overrides-esbuild', 'overrides-keys:']);
  });

  it('rejects an esbuild override value other than $esbuild', () => {
    expect(esbuildOverrideFailures({ esbuild: '0.25.12' })).toEqual(['overrides-esbuild']);
  });

  it('rejects an esbuild override object that has another key', () => {
    expect(esbuildOverrideFailures({ esbuild: '$esbuild', other: '1' })).toEqual([
      'overrides-keys:esbuild,other',
    ]);
  });

  it('rejects a bare esbuild install-script approval', () => {
    expect(installScriptApprovalFailures({ ...ALLOWED_INSTALL_SCRIPTS, esbuild: true })).toEqual([
      'allow-scripts-keys:better-sqlite3@13.0.3,esbuild,esbuild@0.25.12,esbuild@0.28.2',
      'allow-scripts-unpinned:esbuild',
    ]);
  });

  it.each(['', 'v0.28.2', '0.25', '0.25.12-beta', '0.25.012', '0.18.20 '])(
    'rejects a non-canonical esbuild version %s',
    (version) => {
      expect(esbuildVersionBelowFix(version)).toBe(true);
    },
  );

  it('matches numeric order for versions below and at 0.25.0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 0, max: 40 }),
        (major, minor, patch) => {
          const below =
            major < ESBUILD_FIX[0] ||
            (major === ESBUILD_FIX[0] && minor < ESBUILD_FIX[1]) ||
            (major === ESBUILD_FIX[0] && minor === ESBUILD_FIX[1] && patch < ESBUILD_FIX[2]);
          expect(esbuildVersionBelowFix(`${major}.${minor}.${patch}`)).toBe(below);
        },
      ),
      { seed: 10131353, numRuns: 200 },
    );
  });
});
