// Contract: optional study clock for end-to-end tests.
// Input: a study deps object, the request, and the process environment.
// Output: the same deps, or a copy whose now() returns the header time.
// The header is x-srep-test-now. Its value is epoch milliseconds.
// The server reads the header only when SREP_E2E_CLOCK is "1".
// Production leaves that variable unset, so the header has no effect.
// A bad header is ignored. The value is an integer from 0 to 8640000000000.

export const TEST_NOW_HEADER = 'x-srep-test-now';

const MAX_MS = 8_640_000_000_000;

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
