const TTL_MS = 15 * 60 * 1000;

type Pending = {
  presetId: string;
  proposedDesiredRetention: number;
  proposedFsrsParams: number[];
  expiresAt: number;
};

const pending = new Map<string, Pending>();

export function stashOptimizerPreview(
  token: string,
  presetId: string,
  proposedDesiredRetention: number,
  proposedFsrsParams: number[],
  nowMs: number,
): void {
  pending.set(token, {
    presetId,
    proposedDesiredRetention,
    proposedFsrsParams,
    expiresAt: nowMs + TTL_MS,
  });
}

export function takeOptimizerPreview(token: string, nowMs: number): Pending | null {
  const row = pending.get(token);
  if (row === undefined) {
    return null;
  }
  pending.delete(token);
  if (row.expiresAt < nowMs) {
    return null;
  }
  return row;
}

export function clearExpiredOptimizerPreviews(nowMs: number): void {
  for (const [key, row] of pending) {
    if (row.expiresAt < nowMs) {
      pending.delete(key);
    }
  }
}
