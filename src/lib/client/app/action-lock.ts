// Contract: one screen action runs at a time.
// The lock stays until the task ends, including the reload after a write.
// A second call while the lock is held does not start.
// No I/O.

export async function withBusy<T>(
  isBusy: () => boolean,
  setBusy: (value: boolean) => void,
  ready: boolean,
  task: () => Promise<T>,
): Promise<T | undefined> {
  if (!ready || isBusy()) {
    return undefined;
  }
  setBusy(true);
  try {
    return await task();
  } finally {
    setBusy(false);
  }
}
