import { readFileSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BREAKPOINT_PX, frameBottom, frameTop, fitTitle, layoutMode } from './grid.js';

describe('layoutMode', () => {
  it('layoutMode(360) and layoutMode(720) are mobile', () => {
    expect(layoutMode(360)).toBe('mobile');
    expect(layoutMode(720)).toBe('mobile');
  });

  it('layoutMode(721) and layoutMode(1440) are desktop', () => {
    expect(layoutMode(721)).toBe('desktop');
    expect(layoutMode(1440)).toBe('desktop');
  });

  it.each([1.5, -1, 10001])('layoutMode(%s) throws bad_width', (width) => {
    expect(() => layoutMode(width)).toThrow(new Error('bad_width'));
  });

  it('keeps the 720px breakpoint in tui.css', () => {
    const css = readFileSync(path.join(import.meta.dirname, 'tui.css'), 'utf8');
    expect(BREAKPOINT_PX).toBe(720);
    expect(css).toContain(`max-width: ${BREAKPOINT_PX}px`);
    expect(css).toContain('width: 80ch');
    expect(css).toContain('width: 78ch');
    expect(css).toContain('width: 32ch');
    expect(css).toContain('width: 30ch');
  });
});

describe('frames', () => {
  it('frameTop(8, empty) and frameBottom(8) are the empty box', () => {
    expect(frameTop(8, '')).toBe('┌──────┐');
    expect(frameBottom(8)).toBe('└──────┘');
  });

  it('frameTop(8, Pane) has length 8 and the top corners', () => {
    const line = frameTop(8, 'Pane');
    expect(line).toHaveLength(8);
    expect(line.startsWith('┌')).toBe(true);
    expect(line.endsWith('┐')).toBe(true);
  });

  it('frameTop rejects a long title, a short width, and a bad character', () => {
    expect(() => frameTop(8, 'PaneX')).toThrow(new Error('bad_title'));
    expect(() => frameTop(7, '')).toThrow(new Error('bad_columns'));
    expect(() => frameTop(8, 'A/B')).toThrow(new Error('bad_title'));
  });

  it('fitTitle(A<b> newline B, 80) is AbB', () => {
    expect(fitTitle('A<b>\nB', 80)).toBe('AbB');
  });

  it('frame lines have length columns for a legal title', () => {
    const titleChar = fc.constantFrom('a', 'Z', '0', ' ', '-');
    const input = fc.integer({ min: 8, max: 120 }).chain((columns) =>
      fc.tuple(
        fc.constant(columns),
        fc
          .array(titleChar, { minLength: 0, maxLength: columns - 4 })
          .map((chars) => chars.join('')),
      ),
    );
    fc.assert(
      fc.property(input, ([columns, title]) => {
        return (
          frameTop(columns, title).length === columns && frameBottom(columns).length === columns
        );
      }),
      { seed: 1, numRuns: 100 },
    );
  });
});
