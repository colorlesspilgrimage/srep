import { describe, expect, it } from 'vitest';
import { gridKeyPlan } from './browse-grid.js';
import { browseKeyAction, type BrowseKeyInput } from './browse-keys.js';

const ROWS = [
  {
    cardId: '123e4567-e89b-42d3-a456-000000000001',
    noteId: '123e4567-e89b-42d3-a456-000000000011',
  },
  {
    cardId: '123e4567-e89b-42d3-a456-000000000002',
    noteId: '123e4567-e89b-42d3-a456-000000000012',
  },
  {
    cardId: '123e4567-e89b-42d3-a456-000000000003',
    noteId: '123e4567-e89b-42d3-a456-000000000013',
  },
];

function grid(key: string, patch: Partial<BrowseKeyInput> = {}) {
  return browseKeyAction({
    key,
    region: 'grid',
    modalOpen: false,
    paletteOpen: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    queryEmpty: true,
    hasSelection: false,
    ...patch,
  });
}

describe('gridKeyPlan', () => {
  it('stops on the last row and the first row', () => {
    expect(gridKeyPlan(grid('ArrowDown'), ROWS, 2)).toEqual({ type: 'move', index: 2 });
    expect(gridKeyPlan(grid('j'), ROWS, 1)).toEqual({ type: 'move', index: 2 });
    expect(gridKeyPlan(grid('ArrowUp'), ROWS, 0)).toEqual({ type: 'move', index: 0 });
    expect(gridKeyPlan(grid('k'), ROWS, 1)).toEqual({ type: 'move', index: 0 });
    expect(gridKeyPlan(grid('Home'), ROWS, 2)).toEqual({ type: 'move', index: 0 });
    expect(gridKeyPlan(grid('End'), ROWS, 0)).toEqual({ type: 'move', index: 2 });
  });

  it('toggles, opens, tabs, clears, and selects the page', () => {
    expect(gridKeyPlan(grid(' '), ROWS, 1)).toEqual({ type: 'toggle', cardId: ROWS[1]?.cardId });
    expect(gridKeyPlan(grid('Enter'), ROWS, 0)).toEqual({ type: 'open', noteId: ROWS[0]?.noteId });
    expect(gridKeyPlan(grid('Tab'), ROWS, 0)).toEqual({ type: 'tab', shift: false });
    expect(gridKeyPlan(grid('Tab', { shiftKey: true }), ROWS, 0)).toEqual({
      type: 'tab',
      shift: true,
    });
    expect(gridKeyPlan(grid('Escape', { hasSelection: true }), ROWS, 0)).toEqual({ type: 'clear' });
    expect(gridKeyPlan(grid('a', { ctrlKey: true }), ROWS, 1)?.type).toBe('page');
  });

  it('does not move an empty grid, and still tabs', () => {
    expect(gridKeyPlan(grid('j'), [], 0)).toEqual({ type: 'none' });
    expect(gridKeyPlan(grid('Tab'), [], 0)).toEqual({ type: 'tab', shift: false });
    expect(gridKeyPlan(grid('Escape'), [], 0)).toEqual({ type: 'blur' });
    expect(gridKeyPlan(grid('1'), ROWS, 0)).toEqual({ type: 'none' });
    expect(gridKeyPlan(grid(' '), ROWS, 9)).toEqual({ type: 'none' });
    expect(gridKeyPlan({ type: 'search' }, ROWS, 0)).toEqual({ type: 'none' });
  });
});
