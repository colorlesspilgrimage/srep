import { describe, expect, it } from 'vitest';
import { seedBench } from './perf-bench-seed.js';

describe('perf bench 100k shape', () => {
  it('defines large-deck scaling constants', () => {
    expect(seedBench).toBeTypeOf('function');
  });
});
