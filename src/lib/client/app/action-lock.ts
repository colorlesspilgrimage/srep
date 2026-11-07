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
