import { describe, expect, it } from 'vitest';
import { POST } from './+server';

describe('import dry-run authz', () => {
  it('exports POST handler', () => {
    expect(POST).toBeTypeOf('function');
  });
});
