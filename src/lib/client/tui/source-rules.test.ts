import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../../..');
const htmlNeedle = '{@' + 'html}';
const styleNeedle = 'style' + '=';

function listSources(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...listSources(full));
      continue;
    }
    if (name.endsWith('.svelte') || name.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

describe('source rules', () => {
  it('svelte and ts sources do not use raw HTML or a style attribute', () => {
    const dirs = [path.join(root, 'src/lib/client/tui'), path.join(root, 'src/routes/gallery')];
    const files = dirs.flatMap((dir) => listSources(dir));
    expect(files.length).toBeGreaterThan(0);
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (text.includes(htmlNeedle) || text.includes(styleNeedle)) {
        hits.push(path.relative(root, file));
      }
    }
    expect(hits).toEqual([]);
  });
});
