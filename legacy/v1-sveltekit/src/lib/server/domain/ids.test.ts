import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { seededRandom } from '#lib/server/auth/test-support/harness.js';
import { newId } from '#lib/server/domain/ids.js';

describe('newId', () => {
  it('gives a valid UUID v4', () => {
    const random = seededRandom();
    for (let i = 0; i < 50; i += 1) {
      const id = newId(random);
      expect(z.uuid().safeParse(id).success).toBe(true);
      expect(id[14]).toBe('4');
      expect('89ab').toContain(id[19]);
    }
  });

  it('is the same for the same seed', () => {
    expect(newId(seededRandom())).toBe(newId(seededRandom()));
    const random = seededRandom();
    expect(newId(random)).not.toBe(newId(random));
  });
});
