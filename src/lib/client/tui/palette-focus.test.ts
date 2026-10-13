import { describe, expect, it } from 'vitest';
import { nextTrapIndex } from './palette-focus.js';

// Contract: Tab wraps inside the dialog. A bad count does not move focus.

describe('palette focus trap', () => {
  it('wraps Tab and Shift+Tab inside the dialog', () => {
    expect(nextTrapIndex(3, 0, false)).toBe(1);
    expect(nextTrapIndex(3, 2, false)).toBe(0);
    expect(nextTrapIndex(3, 0, true)).toBe(2);
    expect(nextTrapIndex(3, 2, true)).toBe(1);
    expect(nextTrapIndex(3, -1, false)).toBe(0);
    expect(nextTrapIndex(3, -1, true)).toBe(2);
  });

  it('returns null when the dialog has no focusable node', () => {
    expect(nextTrapIndex(0, 0, false)).toBeNull();
    expect(nextTrapIndex(1.5, 0, false)).toBeNull();
  });
});
