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

console.log('contracts/ scaffold written (extend export-contracts.mjs for full Vitest dump)');
