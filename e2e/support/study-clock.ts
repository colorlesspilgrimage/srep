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
