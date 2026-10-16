import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sanitizeCardHtml } from './sanitize-card.js';

const HEX = 'ab'.repeat(32);
const MARKS = ['<span class="cloze">', '</span>', '<br>', '<hr>'];

function assertMarks(html: string): void {
  let index = 0;
  while (index < html.length) {
    if (html.charAt(index) !== '<') {
      index += 1;
      continue;
    }
    const rest = html.slice(index);
    const img = /^<img src="\/api\/media\/[0-9a-f]{64}" alt="">/.exec(rest);
    if (img !== null) {
      index += img[0].length;
      continue;
    }
    const mark = MARKS.find((item) => rest.startsWith(item));
    expect(mark, html.slice(index, index + 40)).toBeTruthy();
    index += mark?.length ?? 1;
  }
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (name.endsWith('.svelte') || (name.endsWith('.ts') && !name.endsWith('.test.ts'))) {
      out.push(full);
    }
  }
}

describe('sanitizeCardHtml', () => {
  it('escapes a script tag', () => {
    const html = sanitizeCardHtml('<script>alert(1)</script>');
    expect(html).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html.includes('<script')).toBe(false);
  });

  it('keeps a cloze span and escapes an img inside it', () => {
    expect(sanitizeCardHtml('<span class="cloze">Tokyo</span>')).toBe(
      '<span class="cloze">Tokyo</span>',
    );
    expect(sanitizeCardHtml('<span class="cloze"><img src=x onerror=alert(1)></span>')).toBe(
      '<span class="cloze">&lt;img src=x onerror=alert(1)&gt;</span>',
    );
  });

  it('replaces a lower-case media token and leaves an upper-case token', () => {
    const html = sanitizeCardHtml(`see {{media:${HEX}}} here`);
    expect(html).toBe(`see <img src="/api/media/${HEX}" alt=""> here`);
    const upper = sanitizeCardHtml(`{{media:${HEX.toUpperCase()}}}`);
    expect(upper.includes('<img')).toBe(false);
    expect(upper.includes(HEX.toUpperCase())).toBe(true);
  });

  it('escapes a javascript URL', () => {
    const html = sanitizeCardHtml('<a href="javascript:alert(1)">x</a>');
    expect(html.includes('<a')).toBe(false);
    expect(html.includes('javascript:alert(1)')).toBe(true);
  });

  it('escapes a close span with no open span and keeps br and hr', () => {
    expect(sanitizeCardHtml('</span>x<span class="cloze">y</span></span>')).toBe(
      '&lt;/span&gt;x<span class="cloze">y</span>&lt;/span&gt;',
    );
    expect(sanitizeCardHtml('a<br>b<hr>c')).toBe('a<br>b<hr>c');
    expect(sanitizeCardHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
    expect(sanitizeCardHtml('<br/>')).toBe('&lt;br/&gt;');
  });

  it('cuts escaped text when the output is longer than 200000 characters', () => {
    const html = sanitizeCardHtml('<'.repeat(200_001));
    expect(html.length).toBe(200_000);
    expect(html.startsWith('&lt;')).toBe(true);
    expect(html.includes('<')).toBe(false);
    const plain = sanitizeCardHtml('a'.repeat(200_001));
    expect(plain).toBe('a'.repeat(200_000));
    const marks = sanitizeCardHtml('<br>'.repeat(50_001));
    expect(marks.length).toBe(200_000);
    expect(marks.startsWith('&lt;')).toBe(true);
  });

  it('keeps a media image on the first pass only', () => {
    const once = sanitizeCardHtml(`{{media:${HEX}}}`);
    expect(once).toBe(`<img src="/api/media/${HEX}" alt="">`);
    expect(sanitizeCardHtml(once).includes('<img')).toBe(false);
  });

  it('assigns card HTML in CardHtml only', () => {
    const files: string[] = [];
    walk(path.resolve('src'), files);
    const hits = files.filter((file) => readFileSync(file, 'utf8').includes('{@html'));
    expect(hits.map((file) => path.relative('src', file))).toEqual([
      'lib/client/card/CardHtml.svelte',
    ]);
  });

  it('emits only allowed marks for any string', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (input) => {
        const html = sanitizeCardHtml(input);
        expect(html.length).toBeLessThanOrEqual(200_000);
        if (html.includes('<') || html.includes('>')) {
          assertMarks(html);
        }
      }),
    );
  });
});
