import { describe, expect, it } from 'vitest';
import {
  parseTestNow,
  safeStudyNow,
  TEST_NOW_HEADER,
  withTestClock,
} from '#lib/server/study/request-clock.js';

const PIN = Date.parse('2026-10-16T23:30:00.000Z');
const ON = { SREP_E2E_CLOCK: '1' };

function request(header: string | undefined): Request {
  const headers = header === undefined ? undefined : { [TEST_NOW_HEADER]: header };
  return new Request('http://localhost/api/study/next', { headers });
}

describe('safeStudyNow', () => {
  it('keeps a time that is at least 20 minutes before 04:00 UTC', () => {
    expect(safeStudyNow(Date.parse('2026-10-16T23:30:00.000Z'))).toBe(
      Date.parse('2026-10-16T23:30:00.000Z'),
    );
    expect(safeStudyNow(Date.parse('2026-10-17T03:40:00.000Z'))).toBe(
      Date.parse('2026-10-17T03:40:00.000Z'),
    );
    expect(safeStudyNow(Date.parse('2026-10-17T04:00:00.000Z'))).toBe(
      Date.parse('2026-10-17T04:00:00.000Z'),
    );
  });

  it('moves the last 20 minutes to 20 minutes after the rollover', () => {
    expect(safeStudyNow(Date.parse('2026-10-17T03:50:00.000Z'))).toBe(
      Date.parse('2026-10-17T04:20:00.000Z'),
    );
    expect(safeStudyNow(Date.parse('2026-10-17T03:40:00.001Z'))).toBe(
      Date.parse('2026-10-17T04:20:00.000Z'),
    );
  });
});

describe('parseTestNow', () => {
  it('accepts an integer epoch up to the bound', () => {
    expect(parseTestNow(String(PIN))).toBe(PIN);
    expect(parseTestNow('0')).toBe(0);
    expect(parseTestNow(String(8_640_000_000_000))).toBe(8_640_000_000_000);
  });

  it('rejects a missing, empty, or non-integer header', () => {
    expect(parseTestNow(null)).toBeUndefined();
    expect(parseTestNow('')).toBeUndefined();
    expect(parseTestNow('12.5')).toBeUndefined();
    expect(parseTestNow('-1')).toBeUndefined();
    expect(parseTestNow('1e6')).toBeUndefined();
    expect(parseTestNow(' 1')).toBeUndefined();
    expect(parseTestNow(`${PIN} `)).toBeUndefined();
  });

  it('rejects a value above the bound or above the safe integer range', () => {
    expect(parseTestNow(String(8_640_000_000_001))).toBeUndefined();
    expect(parseTestNow('9007199254740993')).toBeUndefined();
    expect(parseTestNow('12345678901234')).toBeUndefined();
  });
});

describe('withTestClock', () => {
  it('returns the same deps when the switch is off or the header is bad', () => {
    const deps = { now: () => 5, id: 'a' };
    expect(withTestClock(deps, request(String(PIN)), {})).toBe(deps);
    expect(withTestClock(deps, request(String(PIN)), { SREP_E2E_CLOCK: '0' })).toBe(deps);
    expect(withTestClock(deps, request(undefined), ON)).toBe(deps);
    expect(withTestClock(deps, request('nope'), ON)).toBe(deps);
    expect(deps.now()).toBe(5);
  });

  it('copies deps and pins now when the switch and the header are valid', () => {
    const deps = { now: () => 5, id: 'a' };
    const pinned = withTestClock(deps, request(String(PIN)), ON);
    expect(pinned).not.toBe(deps);
    expect(pinned.id).toBe('a');
    expect(pinned.now()).toBe(PIN);
    expect(deps.now()).toBe(5);
  });
});
