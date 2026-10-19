// Contract: turn a grid key action into one row change.
// An empty grid still tabs and blurs. It does not move.
// No I/O.

import { pageCardIds, rowIndexAfter } from './browse-model.js';
import type { BrowseKeyAction } from './browse-keys.js';

export type GridPlan =
  | { type: 'none' }
  | { type: 'move'; index: number }
  | { type: 'toggle'; cardId: string }
  | { type: 'open'; noteId: string }
  | { type: 'tab'; shift: boolean }
  | { type: 'clear' }
  | { type: 'page'; cardIds: string[] }
  | { type: 'blur' };

type GridRow = { cardId: string; noteId: string };

export function gridKeyPlan(
  action: BrowseKeyAction,
  rows: readonly GridRow[],
  active: number,
): GridPlan {
  if (action.type === 'tab') {
    return { type: 'tab', shift: action.shift };
  }
  if (action.type === 'blur') {
    return { type: 'blur' };
  }
  if (action.type === 'clear-selection') {
    return { type: 'clear' };
  }
  if (action.type === 'none' || action.type === 'palette' || rows.length === 0) {
    return { type: 'none' };
  }
  if (action.type === 'move') {
    return { type: 'move', index: rowIndexAfter(rows.length, active, action.move) };
  }
  const row = rows[active];
  if (row === undefined) {
    return { type: 'none' };
  }
  if (action.type === 'toggle') {
    return { type: 'toggle', cardId: row.cardId };
  }
  if (action.type === 'open') {
    return { type: 'open', noteId: row.noteId };
  }
  if (action.type === 'select-page') {
    return { type: 'page', cardIds: pageCardIds(rows) };
  }
  return { type: 'none' };
}
