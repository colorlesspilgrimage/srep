#!/usr/bin/env node
/**
 * Exports golden JSON fixtures from TypeScript Vitest sources into contracts/.
 * Run on the v1 tree: node scripts/export-contracts.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const contracts = path.join(root, 'contracts');

const stubs = {
  'README.md': `# Contract fixtures\n\nGolden JSON for cross-language parity (Rust v2 vs TypeScript v1).\n\nGenerate with \`node scripts/export-contracts.mjs\` after extending the exporter.\n`,
  'fsrs/.gitkeep': '',
  'browse/.gitkeep': '',
  'templates/.gitkeep': '',
  'sanitizer/.gitkeep': '',
};

fs.mkdirSync(contracts, { recursive: true });
for (const [rel, body] of Object.entries(stubs)) {
  const dest = path.join(contracts, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(dest)) {
    fs.writeFileSync(dest, body);
  }
}

const samples = {
  'auth/status.json': {
    setupComplete: false,
    hasRecoveryCodes: false,
    session: null,
  },
  'decks/create-request.json': {
    name: 'Languages',
    parentId: null,
    presetId: '00000000-0000-4000-8000-000000000001',
  },
  'decks/create-response.json': {
    id: '123e4567-e89b-42d3-a456-426614174000',
    parentId: null,
    name: 'Languages',
    path: 'Languages',
    presetId: '00000000-0000-4000-8000-000000000001',
    description: '',
    archivedAt: null,
  },
};

for (const [rel, body] of Object.entries(samples)) {
  const dest = path.join(contracts, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(body, null, 2)}\n`);
}

console.log('contracts/ scaffold and auth/deck samples written');
