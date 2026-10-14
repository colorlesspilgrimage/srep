// Contract: median and p95 for a bench sample.
// Input: a non-empty list of numbers. Output: one number.
// An even count uses the mean of the two middle sorted values.
// p95 uses sorted index ceil(0.95 * count) - 1.

export function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}
