/** Mirrors legacy `request-clock.ts` for E2E (v1 src archived under `legacy/v1-sveltekit`). */
function safeStudyNow(now: number): number {
  const MINUTE_MS = 60_000;
  const DAY_MS = 86_400_000;
  const ROLLOVER_MS = 4 * 60 * MINUTE_MS;
  const SAFE_GAP_MS = 20 * MINUTE_MS;
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
  let end = dayStart + ROLLOVER_MS;
  if (end <= now) {
    end += DAY_MS;
  }
  if (end - now >= SAFE_GAP_MS) {
    return now;
  }
  return end + SAFE_GAP_MS;
}

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
