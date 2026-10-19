// Contract: follow-up after a bulk write, and extra delete-dialog keys.
// A failed write keeps the selection. A success reloads the captured query.
// Delete, Backspace, digits, and Ctrl+A do not act while the dialog is open.
// No I/O.

import { writeMessage } from './browse-model.js';

export type WriteFollowUp = { type: 'stay'; message: string } | { type: 'reload'; query: string };

const EXTRA_KEYS = new Set(['Delete', 'Backspace', '1', '2', '3', '4']);

export function writeFollowUp(ok: boolean, error: string, query: string): WriteFollowUp {
  if (!ok) {
    return { type: 'stay', message: writeMessage(error) };
  }
  return { type: 'reload', query };
}

export function dialogMustStop(key: string, ctrlKey: boolean, metaKey: boolean): boolean {
  if (EXTRA_KEYS.has(key)) {
    return true;
  }
  return (ctrlKey || metaKey) && (key === 'a' || key === 'A');
}
