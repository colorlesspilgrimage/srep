import { describe, expect, it } from 'vitest';
import { newNoteQuery, notePagePath } from './note-editor-paths.js';

const ID = '123e4567-e89b-42d3-a456-426614174000';

describe('note editor paths', () => {
  it('encodes a UUID', () => {
    expect(newNoteQuery(ID)).toBe(encodeURIComponent(ID));
    expect(notePagePath(ID.toUpperCase())).toBe(`/notes/${encodeURIComponent(ID.toUpperCase())}`);
  });

  it('rejects a bad id and does not build a path', () => {
    for (const id of ['', 'notes', '../x', `${ID}/edit`, 'not-a-uuid', `${ID}\n`, `${ID} `]) {
      expect(newNoteQuery(id)).toBeNull();
      expect(notePagePath(id)).toBeNull();
    }
  });
});
