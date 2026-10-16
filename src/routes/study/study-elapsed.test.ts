import { describe, expect, it } from 'vitest';
import { elapsedMs } from '#lib/client/app/study-elapsed.js';

describe('elapsedMs', () => {
  it('rounds and clamps to 0 through 3600000', () => {
    expect(elapsedMs(1000, 1500.4)).toBe(500);
    expect(elapsedMs(1000, 1000)).toBe(0);
    expect(elapsedMs(2000, 1000)).toBe(0);
    expect(elapsedMs(0, 3_600_000)).toBe(3_600_000);
    expect(elapsedMs(0, 3_600_001)).toBe(3_600_000);
    expect(elapsedMs(Number.NaN, 10)).toBe(0);
    expect(elapsedMs(10, Number.POSITIVE_INFINITY)).toBe(0);
  });
});
