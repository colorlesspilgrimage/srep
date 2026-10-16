import { describe, expect, it } from 'vitest';
import { deckResourcePath, isDeckUuid } from './deck-id.js';

const ID = '123e4567-e89b-42d3-a456-426614174000';

describe('deck id path', () => {
  it('accepts a UUID and encodes it into the path', () => {
    expect(isDeckUuid(ID)).toBe(true);
    expect(isDeckUuid(ID.toUpperCase())).toBe(true);
    expect(deckResourcePath(ID, 'item')).toBe(`/api/decks/${ID}`);
    expect(deckResourcePath(ID.toUpperCase(), 'impact')).toBe(
      `/api/decks/${encodeURIComponent(ID.toUpperCase())}/impact`,
    );
  });

  it('rejects a bad id and does not build a path', () => {
    for (const id of ['', 'counts', '../x', `${ID}/impact`, 'not-a-uuid']) {
      expect(isDeckUuid(id)).toBe(false);
      expect(deckResourcePath(id, 'item')).toBeNull();
      expect(deckResourcePath(id, 'impact')).toBeNull();
    }
  });
});
