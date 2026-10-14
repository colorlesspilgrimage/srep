// Contract: fail when client JS gzip bytes exceed the budget.
// Input: the files under build/client/_app/immutable.
// The budget number is read from bundle-budget.json next to this file.
// The script does not read environment text into a path.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export function gzipLimit() {
  const file = path.join(scriptDir, 'bundle-budget.json');
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof raw.clientJsGzipMax !== 'number') {
    throw new Error('bad budget');
  }
  return raw.clientJsGzipMax;
}

function walkJs(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      walkJs(full, out);
      continue;
    }
    if (name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

export function clientJsGzipBytes(clientDir) {
  const root = path.join(clientDir, '_app', 'immutable');
  let sum = 0;
  for (const file of walkJs(root, [])) {
    sum += gzipSync(readFileSync(file)).length;
  }
  return sum;
}

export function budgetResult(clientDir) {
  if (!existsSync(clientDir)) {
    return { ok: false, reason: 'missing', bytes: 0, max: gzipLimit() };
  }
  const bytes = clientJsGzipBytes(clientDir);
  const max = gzipLimit();
  return { ok: bytes <= max, reason: bytes <= max ? 'ok' : 'over', bytes, max };
}

function main() {
  const clientDir = path.resolve('build', 'client');
  const result = budgetResult(clientDir);
  console.log(`client js gzip bytes ${result.bytes}`);
  if (!result.ok) {
    process.exit(1);
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main();
}
