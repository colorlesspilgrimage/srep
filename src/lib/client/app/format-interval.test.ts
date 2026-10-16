import { describe, expect, it } from 'vitest';
import { formatInterval } from './format-interval.js';

describe('formatInterval', () => {
  it('formats the built-in new-card intervals', () => {
    expect(formatInterval(1)).toBe('1m');
    expect(formatInterval(6)).toBe('6m');
    expect(formatInterval(10)).toBe('10m');
    expect(formatInterval(11520)).toBe('8d');
  });

  it('uses hours only when the value divides by 60 and is under a day', () => {
    expect(formatInterval(0)).toBe('0m');
    expect(formatInterval(59)).toBe('59m');
    expect(formatInterval(60)).toBe('1h');
    expect(formatInterval(61)).toBe('61m');
    expect(formatInterval(120)).toBe('2h');
    expect(formatInterval(1439)).toBe('1439m');
  });

  it('uses days only when the value divides by 1440', () => {
    expect(formatInterval(1440)).toBe('1d');
    expect(formatInterval(1441)).toBe('1441m');
    expect(formatInterval(2880)).toBe('2d');
  });

  it('returns 0m for a non-integer or a negative value', () => {
    expect(formatInterval(-1)).toBe('0m');
    expect(formatInterval(1.5)).toBe('0m');
    expect(formatInterval(Number.NaN)).toBe('0m');
    expect(formatInterval(Number.POSITIVE_INFINITY)).toBe('0m');
  });
});
