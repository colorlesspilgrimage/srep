export const MAX_ELAPSED_MS = 3_600_000;

export function elapsedMs(startedAt: number, now: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) {
    return 0;
  }
  const delta = Math.round(now - startedAt);
  if (delta < 0) {
    return 0;
  }
  if (delta > MAX_ELAPSED_MS) {
    return MAX_ELAPSED_MS;
  }
  return delta;
}
