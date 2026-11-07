import { describe, expect, it } from 'vitest';
import {
  bulkNoteIds,
  planAll,
  planTagReplace,
  snapsFrom,
} from '#lib/server/domain/store/note-bulk-plan.js';

const a = '00000000-0000-4000-8000-000000000010';
const b = '00000000-0000-4000-8000-000000000020';

describe('bulkNoteIds', () => {
  it('sorts unique ids and rejects a bad list', () => {
    expect(bulkNoteIds([b, a, b])).toEqual([a, b]);
    const mixed = 'abcdefab-cdef-4abc-8def-0123456789ab';
    expect(bulkNoteIds([mixed.toUpperCase(), mixed])).toEqual([mixed]);
    expect(bulkNoteIds([])).toBeNull();
    expect(bulkNoteIds(Array.from({ length: 101 }, () => a))).toBeNull();
    expect(bulkNoteIds([`'; drop table note; --`])).toBeNull();
    expect(bulkNoteIds(['not-a-uuid'])).toBeNull();
  });
});

describe('planTagReplace', () => {
  it('adds, removes, and rejects a bad tag', () => {
    expect(planTagReplace(['animals'], ['Plants'], [])).toEqual(['animals', 'plants']);
    expect(planTagReplace(['animals', 'plants'], [], ['Animals'])).toEqual(['plants']);
    expect(planTagReplace(['animals'], ['plants'], ['animals'])).toEqual(['plants']);
    expect(planTagReplace(['animals'], [], [])).toEqual(['animals']);
    expect(planTagReplace(['a'], ['bad tag'], [])).toBeNull();
    expect(planTagReplace(['a'], [], ['bad tag'])).toBeNull();
    const many = Array.from({ length: 100 }, (_, i) => `t${i}`);
    expect(planTagReplace(many, ['extra'], [])).toBeNull();
  });
});

describe('snapsFrom', () => {
  it('returns null when an id is missing or trashed', () => {
    expect(snapsFrom([a], [], [])).toBeNull();
    expect(snapsFrom([a], [{ id: a, deletedAt: 5 }], [])).toBeNull();
    expect(snapsFrom([a], [{ id: a, deletedAt: null }], [{ noteId: a, tag: 'z' }])).toEqual([
      { id: a, tags: ['z'] },
    ]);
  });
});

describe('planAll', () => {
  it('returns null when any note has a bad tag plan', () => {
    expect(planAll([{ id: a, tags: ['a'] }], ['b'], [])).toEqual([{ id: a, tags: ['a', 'b'] }]);
    expect(
      planAll(
        [
          { id: a, tags: ['a'] },
          { id: b, tags: ['b'] },
        ],
        ['bad tag'],
        [],
      ),
    ).toBeNull();
  });
});
