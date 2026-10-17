// Fixed study clock for end-to-end tests.
// 2026-10-16 23:30 UTC is 18:30 CT. The study day ends at 04:00 UTC.
// A 10-minute Good step stays inside that day.
// SREP_E2E_NOW overrides the pin for a local check. CI does not set it.

export const STUDY_CLOCK_HEADER = 'x-srep-test-now';
export const SAFE_STUDY_CLOCK_MS = Date.parse('2026-10-16T23:30:00.000Z');

export function studyClockMs(): number {
  const raw = process.env.SREP_E2E_NOW;
  if (raw === undefined || raw.length === 0) {
    return SAFE_STUDY_CLOCK_MS;
  }
  const value = Date.parse(raw);
  if (!Number.isFinite(value)) {
    throw new Error('SREP_E2E_NOW must be an ISO time');
  }
  return value;
}

export function studyClockHeader(): Record<string, string> {
  return { [STUDY_CLOCK_HEADER]: String(studyClockMs()) };
}
