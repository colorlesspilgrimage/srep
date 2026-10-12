import { describe } from 'vitest';
import { defineStudyStoreSuite } from '#lib/server/study/store/study-store.suite.js';
import { createStudyHarness } from '#lib/server/study/test-support/harness.js';

describe('study store (sqlite)', () => {
  defineStudyStoreSuite(() => createStudyHarness());
});
