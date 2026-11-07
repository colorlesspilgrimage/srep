import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const MAX = 204_800;

function walkJs(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      walkJs(full, out);
      continue;
    }
    if (name.endsWith('.js') && name.includes('study')) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const clientDir = path.resolve('build', 'client', '_app', 'immutable');
  if (!existsSync(clientDir)) {
    console.error('missing build/client');
    process.exit(1);
  }
  let sum = 0;
  for (const file of walkJs(clientDir, [])) {
    sum += gzipSync(readFileSync(file)).length;
  }
  console.log(`study-related client js gzip bytes ${sum}`);
  if (sum > MAX) {
    process.exit(1);
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main();
}
