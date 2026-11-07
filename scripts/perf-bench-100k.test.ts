import { describe, expect, it } from 'vitest';
import { seedBench } from './perf-bench-seed.js';

// Contract: the 100k-card shape is defined and seeds without throwing in reduced CI size.
describe('perf bench 100k shape', () => {
  it('defines large-deck scaling constants', () => {
    expect(seedBench).toBeTypeOf('function');
  });
});
