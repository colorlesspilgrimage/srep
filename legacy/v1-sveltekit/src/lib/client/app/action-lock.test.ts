import { describe, expect, it } from 'vitest';
import { withBusy } from './action-lock.js';

describe('withBusy', () => {
  it('holds the lock until the task ends', async () => {
    let busy = false;
    let release: (value: string) => void = () => {};
    const first = withBusy(
      () => busy,
      (value) => {
        busy = value;
      },
      true,
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const second = await withBusy(
      () => busy,
      (value) => {
        busy = value;
      },
      true,
      async () => 'second',
    );
    expect(second).toBeUndefined();
    expect(busy).toBe(true);
    release('first');
    await expect(first).resolves.toBe('first');
    expect(busy).toBe(false);
  });

  it('does not start when the screen is not ready', async () => {
    let busy = false;
    const result = await withBusy(
      () => busy,
      (value) => {
        busy = value;
      },
      false,
      async () => 'ran',
    );
    expect(result).toBeUndefined();
    expect(busy).toBe(false);
  });
});
