import { describe, expect, it } from 'vitest';
import type { DeckTreeKeyAction } from './deck-tree-keys.js';
import {
  deckLevel,
  effectForTreeKey,
  rowFromMove,
  toggleExpanded,
  visibleDeckRows,
  type TreeKeyState,
} from './deck-tree-state.js';

const chain = [
  { id: 'languages', parentId: null, name: 'Languages' },
  { id: 'spanish', parentId: 'languages', name: 'Spanish' },
  { id: 'french', parentId: 'spanish', name: 'French' },
];

function state(patch: Partial<TreeKeyState> = {}): TreeKeyState {
  return {
    visible: chain,
    index: 0,
    expandedIds: new Set(['languages', 'spanish']),
    rowId: 'languages',
    parentId: null,
    decks: chain,
    ...patch,
  };
}

describe('visibleDeckRows', () => {
  it('shows a child only when every ancestor is expanded', () => {
    expect(visibleDeckRows(chain, new Set()).map((row) => row.id)).toEqual(['languages']);
    expect(visibleDeckRows(chain, new Set(['languages'])).map((row) => row.id)).toEqual([
      'languages',
      'spanish',
    ]);
    expect(visibleDeckRows(chain, new Set(['languages', 'spanish'])).map((row) => row.id)).toEqual([
      'languages',
      'spanish',
      'french',
    ]);
  });

  it('keeps a row whose parent is missing', () => {
    const rows = [{ id: 'orphan', parentId: 'gone' }];
    expect(visibleDeckRows(rows, new Set())).toEqual(rows);
  });

  it('hides a parent cycle', () => {
    const rows = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ];
    expect(visibleDeckRows(rows, new Set(['a', 'b']))).toEqual([]);
  });
});

describe('toggleExpanded and rowFromMove', () => {
  it('toggles a parent and leaves a leaf unchanged', () => {
    const open = toggleExpanded(new Set(), 'languages', true);
    expect([...open]).toEqual(['languages']);
    expect([...toggleExpanded(open, 'languages', true)]).toEqual([]);
    expect([...toggleExpanded(open, 'french', false)]).toEqual(['languages']);
  });

  it('moves inside three rows and stops at the ends', () => {
    expect(rowFromMove(chain, 0, 'ArrowDown')).toBe(1);
    expect(rowFromMove(chain, 2, 'ArrowDown')).toBe(2);
    expect(rowFromMove(chain, 0, 'ArrowUp')).toBe(0);
    expect(rowFromMove(chain, 1, 'Home')).toBe(0);
    expect(rowFromMove(chain, 0, 'End')).toBe(2);
    expect(rowFromMove([], 0, 'ArrowDown')).toBeNull();
  });
});

describe('deckLevel', () => {
  it('counts ancestors for three decks', () => {
    expect(deckLevel(chain, 'languages')).toBe(1);
    expect(deckLevel(chain, 'spanish')).toBe(2);
    expect(deckLevel(chain, 'french')).toBe(3);
  });
});

describe('effectForTreeKey', () => {
  it('selects the next row, the child, or the parent', () => {
    const move: DeckTreeKeyAction = { type: 'move', key: 'ArrowDown' };
    expect(effectForTreeKey(move, state())).toMatchObject({ type: 'select', id: 'spanish' });
    const child: DeckTreeKeyAction = { type: 'child' };
    expect(effectForTreeKey(child, state())).toMatchObject({ type: 'select', id: 'spanish' });
    const parent: DeckTreeKeyAction = { type: 'parent' };
    expect(
      effectForTreeKey(parent, state({ rowId: 'spanish', parentId: 'languages' })),
    ).toMatchObject({ type: 'select', id: 'languages' });
  });

  it('expands and collapses the selected row', () => {
    const expand = effectForTreeKey({ type: 'expand' }, state({ expandedIds: new Set() }));
    expect(expand.type === 'select' && [...expand.expandedIds]).toEqual(['languages']);
    const collapse = effectForTreeKey(
      { type: 'collapse' },
      state({ expandedIds: new Set(['languages']) }),
    );
    expect(collapse.type === 'select' && [...collapse.expandedIds]).toEqual([]);
  });

  it('ignores tab and none, and prevents space', () => {
    expect(effectForTreeKey({ type: 'tab', shift: true }, state())).toEqual({ type: 'ignore' });
    expect(effectForTreeKey({ type: 'none' }, state())).toEqual({ type: 'ignore' });
    expect(effectForTreeKey({ type: 'prevent' }, state())).toEqual({ type: 'prevent' });
    expect(effectForTreeKey({ type: 'focus-name' }, state())).toEqual({ type: 'focus-name' });
    expect(effectForTreeKey({ type: 'move', key: 'ArrowDown' }, state({ visible: [] }))).toEqual({
      type: 'ignore',
    });
    expect(effectForTreeKey({ type: 'child' }, state({ decks: [] }))).toEqual({ type: 'ignore' });
    expect(effectForTreeKey({ type: 'parent' }, state({ parentId: null }))).toEqual({
      type: 'ignore',
    });
  });
});
