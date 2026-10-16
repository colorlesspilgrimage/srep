import { describe, expect, it } from 'vitest';
import {
  afterMutation,
  joinDeckViews,
  keptSelection,
  moveTargetIds,
  type CountRow,
  type DeckListRow,
} from './deck-screen.js';

function deck(id: string, parentId: string | null, name: string): DeckListRow {
  return { id, parentId, name, archivedAt: null };
}

describe('joinDeckViews', () => {
  it('joins counts and drops an archived deck', () => {
    const decks = [
      deck('a', null, 'Languages'),
      { ...deck('b', 'a', 'Old'), archivedAt: 5 },
      deck('c', 'a', 'Spanish'),
    ];
    const counts: CountRow[] = [{ id: 'a', subtree: { new: 1, learning: 2, due: 3 } }];
    expect(joinDeckViews(decks, counts)).toEqual([
      { id: 'a', parentId: null, name: 'Languages', subtree: { new: 1, learning: 2, due: 3 } },
      { id: 'c', parentId: 'a', name: 'Spanish', subtree: { new: 0, learning: 0, due: 0 } },
    ]);
  });
});

describe('move targets and selection', () => {
  it('omits the subtree and keeps the selected id', () => {
    const decks = [deck('a', null, 'A'), deck('b', 'a', 'B'), deck('c', null, 'C')];
    expect(moveTargetIds(decks, 'a')).toEqual(['c']);
    expect(moveTargetIds(decks, 'c')).toEqual(['a', 'b']);
    expect(keptSelection(decks, 'b')).toBe('b');
    expect(keptSelection(decks, 'gone')).toBe('a');
    expect(keptSelection([], 'a')).toBeNull();
  });

  it('expands the parent after a child create', () => {
    const next = afterMutation({
      decks: [deck('a', null, 'A'), deck('b', 'a', 'B')],
      expanded: new Set(),
      selectedId: 'b',
      parentId: 'a',
    });
    expect(next.selectedId).toBe('b');
    expect([...next.expanded]).toEqual(['a']);
  });
});
