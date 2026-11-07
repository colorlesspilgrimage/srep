import { describe, expect, it } from 'vitest';
import { noteResourcePath, studyDeckQuery, studyNextPath } from '#lib/client/app/study-paths.js';

const ID = '123e4567-e89b-42d3-a456-426614174000';

describe('study paths', () => {
  it('encodes a UUID and leaves the all-decks path without a query', () => {
    expect(studyNextPath(null)).toBe('/api/study/next');
    expect(studyNextPath(ID)).toBe(`/api/study/next?deckId=${encodeURIComponent(ID)}`);
    expect(studyDeckQuery(ID.toUpperCase())).toBe(encodeURIComponent(ID.toUpperCase()));
    expect(noteResourcePath(ID)).toBe(`/api/notes/${encodeURIComponent(ID)}`);
  });

  it('rejects a bad id and does not build a path', () => {
    for (const id of ['', 'next', '../x', `${ID}/next`, 'not-a-uuid', `${ID}\n`, `${ID} `]) {
      expect(studyNextPath(id)).toBeNull();
      expect(studyDeckQuery(id)).toBeNull();
      expect(noteResourcePath(id)).toBeNull();
    }
  });
});
