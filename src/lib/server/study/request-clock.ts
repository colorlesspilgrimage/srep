export const TEST_NOW_HEADER = 'x-srep-test-now';

const MAX_MS = 8_640_000_000_000;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const ROLLOVER_MS = 4 * 60 * MINUTE_MS;
const SAFE_GAP_MS = 20 * MINUTE_MS;

export function safeStudyNow(now: number): number {
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

export function parseTestNow(header: string | null): number | undefined {
  if (header === null || !/^[0-9]{1,13}$/.test(header)) {
    return undefined;
  }
  const value = Number(header);
  if (!Number.isSafeInteger(value) || value > MAX_MS) {
    return undefined;
  }
  return value;
}

type ClockDeps = { now: () => number };

export function withTestClock<T extends ClockDeps>(
  deps: T,
  request: Request,
  env: Record<string, string | undefined> = process.env,
): T {
  if (env.SREP_E2E_CLOCK !== '1') {
    return deps;
  }
  const nowMs = parseTestNow(request.headers.get(TEST_NOW_HEADER));
  if (nowMs === undefined) {
    return deps;
  }
  return { ...deps, now: () => nowMs };
}
