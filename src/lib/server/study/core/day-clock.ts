// Contract: pure study-day arithmetic. Inputs are epoch milliseconds and StudySettings.
// No clock and no I/O. The time-zone rules come from the Intl data of the Node build.
//
// A study day starts at rolloverHour:00 local time. A local time before rolloverHour
// belongs to the previous calendar day. The end of a day is the start of the next
// local calendar date, so a DST day is 23 or 25 hours long.
// A rollover hour inside a DST gap (spring forward) resolves to the first instant after
// the gap. A rollover hour inside a DST overlap (fall back) resolves to the first occurrence.
// Errors: studyWindow throws a RangeError for a time zone that Intl does not know.
// Call isValidTimezone before a time zone is stored.
import type { StudySettings, StudyWindow } from '#lib/server/study/core/types.js';

const DAY_MS = 86_400_000;
const TIMEZONE_PATTERN = /^[A-Za-z0-9_/+-]{1,64}$/;

export function isValidTimezone(name: string): boolean {
  if (!TIMEZONE_PATTERN.test(name)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

// Intl accepts every case form of a zone name, so the keys are not bounded by the IANA list.
// The cache clears when full (CWE-770).
export const MAX_CACHED_TIMEZONES = 64;
const formatters = new Map<string, Intl.DateTimeFormat>();

/** The number of cached formatters. Test seam for the cache bound. */
export function cachedTimezoneCount(): number {
  return formatters.size;
}

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (formatter === undefined) {
    if (formatters.size >= MAX_CACHED_TIMEZONES) {
      formatters.clear();
    }
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

function localParts(utcMs: number, timezone: string): LocalParts & { second: number } {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timezone).formatToParts(utcMs)) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  }
  return {
    year: values.year ?? 1970,
    month: values.month ?? 1,
    day: values.day ?? 1,
    hour: (values.hour ?? 0) % 24,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

/** Local time minus UTC, in milliseconds, at the instant utcMs. */
function offsetAt(utcMs: number, timezone: string): number {
  const p = localParts(utcMs, timezone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(utcMs / 1000) * 1000;
}

function sameWallHour(utcMs: number, timezone: string, target: LocalParts): boolean {
  const p = localParts(utcMs, timezone);
  return (
    p.year === target.year &&
    p.month === target.month &&
    p.day === target.day &&
    p.hour === target.hour &&
    p.minute === target.minute
  );
}

// Two passes: the offset one day before and one day after the wall time. They are the
// offsets on both sides of a transition. A valid candidate shows the target wall time.
function localWallToUtc(dateUtcMs: number, hour: number, timezone: string): number {
  const wallAsUtc = dateUtcMs + hour * 3_600_000;
  const date = new Date(dateUtcMs);
  const target: LocalParts = {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour,
    minute: 0,
  };
  const before = wallAsUtc - offsetAt(wallAsUtc - DAY_MS, timezone);
  const after = wallAsUtc - offsetAt(wallAsUtc + DAY_MS, timezone);
  const valid = [before, after].filter((t) => sameWallHour(t, timezone, target));
  if (valid.length > 0) {
    return Math.min(...valid);
  }
  // A gap: the offset before the gap moves the wall time to the end of the gap.
  return before;
}

export function studyWindow(nowMs: number, settings: StudySettings): StudyWindow {
  const local = localParts(nowMs, settings.timezone);
  const calendarDay = Date.UTC(local.year, local.month - 1, local.day);
  const studyDate = local.hour < settings.rolloverHour ? calendarDay - DAY_MS : calendarDay;
  return {
    dayNumber: Math.round(studyDate / DAY_MS),
    startMs: localWallToUtc(studyDate, settings.rolloverHour, settings.timezone),
    endMs: localWallToUtc(studyDate + DAY_MS, settings.rolloverHour, settings.timezone),
  };
}
