import { describe } from 'vitest';
import { defineStoreSuite } from '#lib/server/auth/store.suite.js';
import { createHarness } from '#lib/server/auth/test-support/harness.js';

describe('auth store (sqlite)', () => {
  defineStoreSuite(() => createHarness());
});
