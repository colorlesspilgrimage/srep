import { readFileSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  PHOSPHOR_GREEN,
  TEXT_TOKEN_KEYS,
  contrastRatio,
  meetsContrast,
  parseHex,
  themeContrastFailures,
  type ThemeTokens,
} from './tokens.js';

describe('parseHex', () => {
  it('parseHex(#5dff5d) returns red 93, green 255, blue 93', () => {
    expect(parseHex('#5dff5d')).toEqual({ red: 93, green: 255, blue: 93 });
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
    expect(contrastRatio('#5dff5d', '#001a00')).toBe(contrastRatio('#001a00', '#5dff5d'));
    expect(contrastRatio('#5dff5d', '#5dff5d')).toBe(1);
    expect(contrastRatio('#000000', '#000000')).toBe(1);
  });

  it('meetsContrast uses the minimum without rounding', () => {
    expect(meetsContrast(4.5, 4.5)).toBe(true);
    expect(meetsContrast(4.499, 4.5)).toBe(false);
    expect(meetsContrast(2.999, 3)).toBe(false);
  });

  it('themeContrastFailures(PHOSPHOR_GREEN) is empty', () => {
    expect(themeContrastFailures(PHOSPHOR_GREEN)).toEqual([]);
  });

  it('themeContrastFailures reports a text pair and the border pair', () => {
    const bad: ThemeTokens = {
      ...PHOSPHOR_GREEN,
      fg: PHOSPHOR_GREEN.bg,
      border: PHOSPHOR_GREEN.bg,
    };
    const failures = themeContrastFailures(bad);
    expect(failures).toContain('fg on bg');
    expect(failures).toContain('border on bg');
    expect(failures).toContain('fg on selection');
  });

  it('tui.css declares each Phosphor Green token', () => {
    const css = readFileSync(path.join(import.meta.dirname, 'tui.css'), 'utf8');
    const keys = Object.keys(PHOSPHOR_GREEN) as (keyof ThemeTokens)[];
    for (const key of keys) {
      expect(css).toContain(`--tui-${key}: ${PHOSPHOR_GREEN[key]};`);
    }
    expect(TEXT_TOKEN_KEYS).toEqual(['fg', 'dim', 'accent', 'good', 'warn', 'bad']);
  });

  it('contrastRatio is at least 1 and symmetric for any two colors', () => {
    const byte = fc.integer({ min: 0, max: 255 });
    const hex = fc.tuple(byte, byte, byte).map(([red, green, blue]) => {
      const part = (channel: number) => channel.toString(16).padStart(2, '0');
      return `#${part(red)}${part(green)}${part(blue)}`;
    });
    fc.assert(
      fc.property(hex, hex, (left, right) => {
        const forward = contrastRatio(left, right);
        const backward = contrastRatio(right, left);
        return forward >= 1 && forward === backward;
      }),
      { seed: 1, numRuns: 100 },
    );
  });
});
