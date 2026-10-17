import { describe, expect, it } from 'vitest';
import { browseHandle, setBrowseHandle } from '#lib/server/browse/test-handle.js';
import type { DbHandle } from '#lib/server/db/client.js';

describe('browseHandle', () => {
  it('throws when the slot is empty and returns the handle after set', () => {
    setBrowseHandle(undefined);
    expect(() => browseHandle()).toThrow(/missing browse handle/);
    const handle = { dialect: 'sqlite' } as DbHandle;
    setBrowseHandle(handle);
    expect(browseHandle()).toBe(handle);
    setBrowseHandle(undefined);
  });
});
