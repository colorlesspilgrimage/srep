// Regenerates the 24 gallery screenshots in the Playwright noble image.
// The image is Ubuntu 24.04 with the Chromium dependencies CI installs.
// That environment uses Liberation Mono for the gallery font stack.
// A host with Cascadia Mono writes different pixels.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const lockPath = path.join(root, 'package-lock.json');
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const version = lock.packages['node_modules/@playwright/test'].version;
const image = `mcr.microsoft.com/playwright:v${version}-noble`;

const inner = `set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq build-essential
find node_modules -mindepth 1 -delete
npm ci
npx playwright test e2e/gallery-visual.test.ts --update-snapshots
chown -R ${process.getuid()}:${process.getgid()} e2e/gallery-visual.test.ts-snapshots
`;

const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--ipc=host',
    '-v',
    `${root}:/work`,
    '-v',
    'srep-visual-node-modules:/work/node_modules',
    '-w',
    '/work',
    '-e',
    'CI=1',
    '-e',
    'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
    image,
    'bash',
    '-lc',
    inner,
  ],
  { stdio: 'inherit' },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
