// Contract: browse screen event handlers. The caller owns the state.
// A bulk handler captures ids before the request. A second call waits on the lock.
// Enter opens a note only after the UUID check inside browseNotePath.
// Focus and select are the only DOM writes.

import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import type { ApiResult } from '#lib/client/api.js';
import { gridKeyPlan } from './browse-grid.js';
import { browseKeyAction, type BrowseKeyInput, type BrowseRegion } from './browse-keys.js';
import {
  browseNotePath,
  moveAllowed,
  noteWriteAllowed,
  selectedCardIds,
  selectedNoteIds,
  tagBody,
  toggleCard,
  type BrowseDeck,
  type BrowseView,
} from './browse-model.js';
import type { createBrowseClient } from './browse-client.js';

export type BrowseSnap = {
  query: string;
  rows: readonly BrowseView[];
  selected: readonly string[];
  active: number;
  decks: readonly BrowseDeck[];
  deckIndex: number;
  tagText: string;
  modalOpen: boolean;
  busy: boolean;
  ready: boolean;
  paletteOpen: boolean;
  pendingNotes: readonly string[];
  searching: boolean;
};

type Patch = {
  query?: string;
  selected?: string[];
  active?: number;
  message?: string;
  modalOpen?: boolean;
  pendingNotes?: string[];
};

type Client = ReturnType<typeof createBrowseClient>;

export type HandlerIo = {
  snap: () => BrowseSnap;
  patch: (value: Patch) => void;
  keyInput: (region: BrowseRegion, event: KeyboardEvent) => BrowseKeyInput;
  searchField: () => HTMLInputElement | null;
  grid: () => HTMLElement | null;
  client: Client;
  runBulk: (task: () => Promise<void>) => void;
  finishWrite: (result: ApiResult<unknown>, query: string) => Promise<void>;
  onSearch: () => void;
};

const BULK_FOCUS =
  '[role="listbox"]:not([aria-disabled="true"]), button:not([disabled]), input:not([disabled])';

function focusBulk(io: HandlerIo, shift: boolean): void {
  if (shift) {
    io.searchField()?.focus();
    return;
  }
  const node = document.getElementById('browse-bulk')?.querySelector<HTMLElement>(BULK_FOCUS);
  node?.focus();
}

function openNote(noteId: string): void {
  if (browseNotePath(noteId) === null) {
    return;
  }
  void goto(resolve('/notes/[id]', { id: noteId }));
}

function onQueryKey(io: HandlerIo, event: KeyboardEvent): void {
  const action = browseKeyAction(io.keyInput('query', event));
  if (action.type === 'search') {
    event.preventDefault();
    io.onSearch();
    return;
  }
  if (action.type === 'clear-query') {
    event.preventDefault();
    io.patch({ query: '' });
    return;
  }
  if (action.type === 'blur') {
    event.preventDefault();
    io.searchField()?.blur();
    return;
  }
  if (action.type === 'select-query') {
    event.preventDefault();
    io.searchField()?.select();
  }
}

function writeBlocked(snap: BrowseSnap): boolean {
  return snap.modalOpen || snap.busy || snap.searching;
}

function onGridKey(io: HandlerIo, event: KeyboardEvent): void {
  const snap = io.snap();
  const plan = gridKeyPlan(browseKeyAction(io.keyInput('grid', event)), snap.rows, snap.active);
  if (plan.type === 'none') {
    return;
  }
  if (
    snap.busy &&
    (plan.type === 'toggle' ||
      plan.type === 'open' ||
      plan.type === 'clear' ||
      plan.type === 'page')
  ) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  if (plan.type === 'move') {
    io.patch({ active: plan.index });
    return;
  }
  if (plan.type === 'toggle') {
    io.patch({ selected: toggleCard(snap.selected, plan.cardId) });
    return;
  }
  if (plan.type === 'open') {
    openNote(plan.noteId);
    return;
  }
  if (plan.type === 'tab') {
    focusBulk(io, plan.shift);
    return;
  }
  if (plan.type === 'clear') {
    io.patch({ selected: [] });
    return;
  }
  if (plan.type === 'page') {
    io.patch({ selected: plan.cardIds });
    return;
  }
  io.grid()?.blur();
}

function runCardBulk(
  io: HandlerIo,
  snap: BrowseSnap,
  send: (ids: string[]) => Promise<ApiResult<unknown>>,
): void {
  if (writeBlocked(snap)) {
    return;
  }
  const ids = [...selectedCardIds(snap.rows, snap.selected)];
  const query = snap.query;
  if (!moveAllowed(ids.length)) {
    return;
  }
  io.runBulk(async () => {
    await io.finishWrite(await send(ids), query);
  });
}

function onMove(io: HandlerIo): void {
  const snap = io.snap();
  const deckId = snap.decks[snap.deckIndex]?.id;
  if (deckId === undefined) {
    return;
  }
  runCardBulk(io, snap, (ids) => io.client.move(ids, deckId));
}

function onTag(io: HandlerIo, mode: 'add' | 'remove'): void {
  const snap = io.snap();
  if (writeBlocked(snap)) {
    return;
  }
  const query = snap.query;
  const body = tagBody(selectedNoteIds(snap.rows, snap.selected), snap.tagText, mode);
  if (body === null) {
    return;
  }
  io.runBulk(async () => {
    await io.finishWrite(await io.client.setTags(body), query);
  });
}

function onSuspend(io: HandlerIo): void {
  runCardBulk(io, io.snap(), (ids) => io.client.suspend(ids));
}

function onDelete(io: HandlerIo): void {
  const snap = io.snap();
  const ids = selectedNoteIds(snap.rows, snap.selected);
  if (writeBlocked(snap) || !noteWriteAllowed(ids.length)) {
    return;
  }
  io.patch({ message: '', modalOpen: true, pendingNotes: [...ids] });
}

function onCloseDelete(io: HandlerIo): void {
  if (io.snap().busy) {
    return;
  }
  io.patch({ modalOpen: false, pendingNotes: [] });
}

function onConfirmDelete(io: HandlerIo): void {
  const snap = io.snap();
  const ids = [...snap.pendingNotes];
  const query = snap.query;
  if (snap.busy || snap.searching || !noteWriteAllowed(ids.length)) {
    return;
  }
  io.runBulk(async () => {
    await io.finishWrite(await io.client.trash(ids), query);
  });
}

export function createBrowseHandlers(io: HandlerIo) {
  return {
    onQueryKey: (event: KeyboardEvent) => onQueryKey(io, event),
    onGridKey: (event: KeyboardEvent) => onGridKey(io, event),
    onPick: (index: number) => {
      if (io.snap().modalOpen) {
        return;
      }
      io.patch({ active: index });
      io.grid()?.focus();
    },
    onCheck: (cardId: string, index: number) => {
      const snap = io.snap();
      if (snap.busy || snap.modalOpen) {
        return;
      }
      io.patch({ active: index, selected: toggleCard(snap.selected, cardId) });
    },
    onMove: () => onMove(io),
    onAdd: () => onTag(io, 'add'),
    onRemove: () => onTag(io, 'remove'),
    onSuspend: () => onSuspend(io),
    onDelete: () => onDelete(io),
    onCloseDelete: () => onCloseDelete(io),
    onConfirmDelete: () => onConfirmDelete(io),
  };
}
