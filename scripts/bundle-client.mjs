#!/usr/bin/env node
import * as esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outdir = path.join(root, 'site', 'shims');

mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, 'scripts', 'client-entry.mjs')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: path.join(outdir, 'srep-client.mjs'),
  minify: false,
});

console.log('Wrote site/shims/srep-client.mjs');
