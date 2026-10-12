import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isValidTimezone, studyWindow } from '#lib/server/study/core/day-clock.js';
import type { StudySettings } from '#lib/server/study/core/types.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (iso: string) => Date.parse(iso);
const utc4: StudySettings = { rolloverHour: 4, timezone: 'UTC' };
const dayNumberOf = (isoDate: string) => Date.parse(`${isoDate}T00:00:00Z`) / DAY;

describe('studyWindow in UTC', () => {
  it('puts 03:59:59.999 in the previous day and starts the new day at 04:00', () => {
    const before = studyWindow(at('2026-01-02T03:59:59.999Z'), utc4);
    expect(before).toEqual({
      dayNumber: dayNumberOf('2026-01-01'),
      startMs: at('2026-01-01T04:00:00Z'),
      endMs: at('2026-01-02T04:00:00Z'),
    });
    const after = studyWindow(at('2026-01-02T04:00:00.000Z'), utc4);
    expect(after.startMs).toBe(at('2026-01-02T04:00:00Z'));
    expect(after.dayNumber).toBe(before.dayNumber + 1);
    expect(after.endMs - after.startMs).toBe(DAY);
  });

  it('supports rollover hours 0 and 23', () => {
    const zero = studyWindow(at('2026-05-10T00:00:00Z'), { rolloverHour: 0, timezone: 'UTC' });
    expect(zero.startMs).toBe(at('2026-05-10T00:00:00Z'));
    const late = { rolloverHour: 23, timezone: 'UTC' };
    expect(studyWindow(at('2026-05-10T22:59:59.999Z'), late).startMs).toBe(
      at('2026-05-09T23:00:00Z'),
    );
    expect(studyWindow(at('2026-05-10T23:00:00Z'), late).startMs).toBe(at('2026-05-10T23:00:00Z'));
  });

  it('gives a day number that grows by exactly one per window', () => {
    let window = studyWindow(at('2026-01-01T09:00:00Z'), utc4);
    for (let i = 0; i < 400; i += 1) {
      const next = studyWindow(window.endMs, utc4);
      expect(next.dayNumber).toBe(window.dayNumber + 1);
      expect(next.startMs).toBe(window.endMs);
      window = next;
    }
  });
});

describe('studyWindow with time zones', () => {
  const newYork = (rolloverHour: number): StudySettings => ({
    rolloverHour,
    timezone: 'America/New_York',
  });

  it('gives 23 hours on the spring-forward day and 25 hours on the fall-back day', () => {
    const spring = studyWindow(at('2026-03-08T12:00:00Z'), newYork(0));
    expect(spring.startMs).toBe(at('2026-03-08T05:00:00Z'));
    expect(spring.endMs - spring.startMs).toBe(23 * HOUR);
    const springAt4 = studyWindow(at('2026-03-07T20:00:00Z'), newYork(4));
    expect(springAt4.endMs - springAt4.startMs).toBe(23 * HOUR);
    const fall = studyWindow(at('2026-11-01T12:00:00Z'), newYork(0));
    expect(fall.startMs).toBe(at('2026-11-01T04:00:00Z'));
    expect(fall.endMs - fall.startMs).toBe(25 * HOUR);
    expect(studyWindow(at('2026-07-01T12:00:00Z'), newYork(4)).endMs).toBe(
      at('2026-07-02T08:00:00Z'),
    );
  });

  it('resolves a rollover hour in the DST gap to the first instant after the gap', () => {
    const day = studyWindow(at('2026-03-08T12:00:00Z'), newYork(2));
    // 02:00 does not exist on 2026-03-08. The clock jumps from 01:59:59 EST to 03:00 EDT.
    expect(day.startMs).toBe(at('2026-03-08T07:00:00Z'));
    expect(day.endMs).toBe(at('2026-03-09T06:00:00Z'));
    const before = studyWindow(at('2026-03-08T06:59:59.999Z'), newYork(2));
    expect(before.endMs).toBe(day.startMs);
  });

  it('resolves a rollover hour in the DST overlap to the first occurrence', () => {
    // 01:00 happens twice on 2026-11-01: at 05:00Z (EDT) and at 06:00Z (EST).
    const first = studyWindow(at('2026-11-01T05:30:00Z'), newYork(1));
    const second = studyWindow(at('2026-11-01T06:30:00Z'), newYork(1));
    expect(first.startMs).toBe(at('2026-11-01T05:00:00Z'));
    expect(second).toEqual(first);
    expect(studyWindow(at('2026-11-01T04:59:59Z'), newYork(1)).endMs).toBe(first.startMs);
  });

  it('handles a half-hour offset and the +14 zone', () => {
    const kolkata = studyWindow(at('2026-01-01T00:00:00Z'), {
      rolloverHour: 4,
      timezone: 'Asia/Kolkata',
    });
    expect(kolkata).toEqual({
      dayNumber: dayNumberOf('2026-01-01'),
      startMs: at('2025-12-31T22:30:00Z'),
      endMs: at('2026-01-01T22:30:00Z'),
    });
    const kiritimati = studyWindow(at('2026-01-01T00:00:00Z'), {
      rolloverHour: 4,
      timezone: 'Pacific/Kiritimati',
    });
    expect(kiritimati).toEqual({
      dayNumber: dayNumberOf('2026-01-01'),
      startMs: at('2025-12-31T14:00:00Z'),
      endMs: at('2026-01-01T14:00:00Z'),
    });
  });
});

describe('isValidTimezone', () => {
  it('accepts IANA names and refuses everything else', () => {
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Europe/Berlin')).toBe(true);
    for (const bad of ['', 'Mars/Base', 'A'.repeat(65), 'UTC; DROP', 'UTC\u0000', '../etc']) {
      expect(isValidTimezone(bad), bad).toBe(false);
    }
  });
});

describe('studyWindow properties (seeded)', () => {
  const zones = [
    'UTC',
    'America/New_York',
    'Europe/Berlin',
    'Asia/Kolkata',
    'Pacific/Kiritimati',
    'Australia/Lord_Howe',
    'America/Santiago',
    'Pacific/Chatham',
  ];

  it('contains now, and consecutive windows touch', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: at('2000-01-01T00:00:00Z'), max: at('2040-01-01T00:00:00Z') }),
        fc.constantFrom(...zones),
        fc.integer({ min: 0, max: 23 }),
        (now, timezone, rolloverHour) => {
          const settings = { rolloverHour, timezone };
          const window = studyWindow(now, settings);
          expect(window.startMs).toBeLessThanOrEqual(now);
          expect(now).toBeLessThan(window.endMs);
          const next = studyWindow(window.endMs, settings);
          expect(next.startMs).toBe(window.endMs);
          expect(next.dayNumber).toBe(window.dayNumber + 1);
          const length = window.endMs - window.startMs;
          expect(length).toBeGreaterThanOrEqual(22 * HOUR);
          expect(length).toBeLessThanOrEqual(26 * HOUR);
        },
      ),
      { seed: 20261012, numRuns: 500 },
    );
  });
});
