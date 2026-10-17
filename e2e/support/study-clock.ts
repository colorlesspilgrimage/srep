// Study clock for the two end-to-end tests that answer Good.
// The server reads x-srep-test-now only when SREP_E2E_CLOCK is "1".
// The review log time never moves backward, so the pin is not in the past.
// SREP_E2E_NOW overrides the pin. SREP_E2E_WALL sets the input time.
// CI does not set either variable.

import { safeStudyNow } from '../../src/lib/server/study/request-clock.js';

export const STUDY_CLOCK_HEADER = 'x-srep-test-now';

export function studyClockMs(now = Date.now()): number {
  const raw = process.env.SREP_E2E_NOW;
  if (raw !== undefined && raw.length > 0) {
    const value = Date.parse(raw);
    if (!Number.isFinite(value)) {
      throw new Error('SREP_E2E_NOW must be an ISO time');
    }
    return value;
  }
  const wall = process.env.SREP_E2E_WALL;
  const base = wall !== undefined && wall.length > 0 ? Date.parse(wall) : now;
  if (!Number.isFinite(base)) {
    throw new Error('SREP_E2E_WALL must be an ISO time');
  }
  return safeStudyNow(base);
}

export function studyClockHeader(nowMs = studyClockMs()): Record<string, string> {
  return { [STUDY_CLOCK_HEADER]: String(nowMs) };
}
