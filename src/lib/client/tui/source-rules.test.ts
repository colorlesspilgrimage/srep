import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasUnsafeClientSource } from './source-rules.js';

const root = path.resolve(import.meta.dirname, '../../../..');

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
    const files = [
      ...dirs.flatMap((dir) => listSources(dir)),
      path.join(root, 'src/routes/+page.svelte'),
    ];
    expect(files.length).toBeGreaterThan(0);
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (hasUnsafeClientSource(text)) {
        hits.push(path.relative(root, file));
      }
    }
    expect(hits).toEqual([]);
  });

  it('flags a raw html expression and a style directive', () => {
    const htmlSample = '{@' + 'html userText}';
    const styleSample = '<p ' + 'style' + ':color="red"></p>';
    const attrSample = '<p ' + 'style' + '="color:red"></p>';
    expect(hasUnsafeClientSource(htmlSample)).toBe(true);
    expect(hasUnsafeClientSource(styleSample)).toBe(true);
    expect(hasUnsafeClientSource(attrSample)).toBe(true);
    expect(hasUnsafeClientSource('<p>text</p>')).toBe(false);
  });
});
