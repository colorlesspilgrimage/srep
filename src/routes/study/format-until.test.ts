import { describe, expect, it } from 'vitest';
import { formatUntil } from '#lib/client/app/format-until.js';

const AT = Date.parse('2026-01-01T09:01:00Z');

describe('formatUntil', () => {
  it('formats with the en-US locale', () => {
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    };
    expect(formatUntil(AT, 'UTC')).toBe(new Intl.DateTimeFormat('en-US', options).format(AT));
    expect(formatUntil(AT)).toBe(
      new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(AT),
    );
  });

  it('returns an empty string for a non-finite value', () => {
    expect(formatUntil(Number.NaN)).toBe('');
    expect(formatUntil(Number.POSITIVE_INFINITY)).toBe('');
    expect(formatUntil(Number.NEGATIVE_INFINITY)).toBe('');
  });

  it('returns an empty string when the time is outside the Date range', () => {
    expect(formatUntil(8_640_000_000_000_001, 'UTC')).toBe('');
    expect(formatUntil(-8_640_000_000_000_001, 'UTC')).toBe('');
    expect(formatUntil(Number.MAX_VALUE)).toBe('');
    expect(formatUntil(0, 'Not/AZone')).toBe('');
  });
});
