import { readFileSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  TEXT_TOKEN_KEYS,
  XAI_DARK,
  contrastRatio,
  meetsContrast,
  parseHex,
  themeContrastFailures,
  type ThemeTokens,
} from './tokens.js';

describe('parseHex', () => {
  it('parseHex(#ffffff) returns red 255, green 255, blue 255', () => {
    expect(parseHex('#ffffff')).toEqual({ red: 255, green: 255, blue: 255 });
  });

  it.each(['#FFF', '#5DFF5D', '5dff5d', '#5dff5dff', ''])(
    'parseHex throws bad_hex for %j',
    (value) => {
      expect(() => parseHex(value)).toThrow(new Error('bad_hex'));
    },
  );
});

describe('contrastRatio', () => {
  it('contrastRatio of black and white is 21', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
  });

  it('contrastRatio is symmetric and a color against itself is 1', () => {
    expect(contrastRatio('#ffffff', '#0a0a0a')).toBe(contrastRatio('#0a0a0a', '#ffffff'));
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    expect(contrastRatio('#000000', '#000000')).toBe(1);
  });

  it('meetsContrast uses the minimum without rounding', () => {
    expect(meetsContrast(4.5, 4.5)).toBe(true);
    expect(meetsContrast(4.499, 4.5)).toBe(false);
    expect(meetsContrast(2.999, 3)).toBe(false);
  });

  it('the focus color meets the non-text minimum on the background', () => {
    expect(meetsContrast(contrastRatio(XAI_DARK.accent, XAI_DARK.bg), 3)).toBe(true);
  });

  it('themeContrastFailures(XAI_DARK) is empty', () => {
    expect(themeContrastFailures(XAI_DARK)).toEqual([]);
  });

  it('themeContrastFailures reports a bad hex and does not throw', () => {
    const bad: ThemeTokens = { ...XAI_DARK, fg: 'not-a-color' };
    expect(() => themeContrastFailures(bad)).not.toThrow();
    expect(themeContrastFailures(bad)).toContain('fg on bg');
    expect(themeContrastFailures(bad)).not.toEqual([]);
  });

  it('themeContrastFailures reports a text pair and the border pair', () => {
    const bad: ThemeTokens = {
      ...XAI_DARK,
      fg: XAI_DARK.bg,
      border: XAI_DARK.bg,
    };
    const failures = themeContrastFailures(bad);
    expect(failures).toContain('fg on bg');
    expect(failures).toContain('border on bg');
    expect(failures).toContain('fg on selection');
  });

  it('tui.css declares each xAI Dark token', () => {
    const css = readFileSync(path.join(import.meta.dirname, 'tui.css'), 'utf8');
    const keys = Object.keys(XAI_DARK) as (keyof ThemeTokens)[];
    for (const key of keys) {
      expect(css).toContain(`--tui-${key}: ${XAI_DARK[key]};`);
    }
    expect(TEXT_TOKEN_KEYS).toEqual(['fg', 'dim', 'accent', 'good', 'warn', 'bad']);
  });

  it('random hex pairs keep contrastRatio finite and at least 1', () => {
    const hex = fc
      .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
      .map(
        ([r, g, b]) =>
          `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
      );
    fc.assert(
      fc.property(hex, hex, (a, b) => {
        const ratio = contrastRatio(a, b);
        return Number.isFinite(ratio) && ratio >= 1;
      }),
      { seed: 1, numRuns: 50 },
    );
  });
});
