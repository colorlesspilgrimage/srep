import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult } from '#lib/client/api.js';
import { createBrowseHandlers, type BrowseSnap, type HandlerIo } from './browse-handlers.js';
import type { BrowseRegion } from './browse-keys.js';
import type { BrowseDeck, BrowseView } from './browse-model.js';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/paths', () => ({
  resolve: (path: string, params?: { id?: string }) =>
    params?.id === undefined ? path : `/notes/${params.id}`,
}));

const CARD_A = '123e4567-e89b-42d3-a456-000000000001';
const CARD_B = '123e4567-e89b-42d3-a456-000000000002';
const CARD_C = '123e4567-e89b-42d3-a456-000000000003';
const NOTE_A = '123e4567-e89b-42d3-a456-000000000011';
const NOTE_B = '123e4567-e89b-42d3-a456-000000000012';
const NOTE_C = '123e4567-e89b-42d3-a456-000000000013';
const DECK = '123e4567-e89b-42d3-a456-000000000021';

function view(cardId: string, noteId: string, frontText: string): BrowseView {
  return {
    cardId,
    noteId,
    deckId: DECK,
    deckPath: 'Spanish',
    state: 'new',
    lapses: 0,
    frontText,
    tags: '',
  };
}

function keyEvent(key: string, patch: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...patch,
  } as unknown as KeyboardEvent;
}

function sampleRows(): BrowseView[] {
  return [
    view(CARD_A, NOTE_A, 'gato'),
    view(CARD_B, NOTE_B, 'perro'),
    view(CARD_C, NOTE_C, 'casa'),
  ];
}

function baseSnap(rows: BrowseView[]): BrowseSnap {
  const decks: BrowseDeck[] = [{ id: DECK, name: 'Spanish' }];
  return {
    query: 'tag:animals',
    rows,
    selected: [CARD_A],
    active: 0,
    decks,
    deckIndex: 0,
    tagText: 'pets',
    modalOpen: false,
    busy: false,
    ready: true,
    paletteOpen: false,
  };
}

function keyFrom(snap: BrowseSnap, region: BrowseRegion, event: KeyboardEvent) {
  return {
    key: event.key,
    region,
    modalOpen: snap.modalOpen,
    paletteOpen: snap.paletteOpen,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    queryEmpty: snap.query.length === 0,
    hasSelection: snap.selected.length > 0,
  };
}

function okClient(): HandlerIo['client'] {
  const ok = async (): Promise<ApiResult<unknown>> => ({ ok: true, status: 200, body: {} });
  return {
    search: vi.fn(),
    listDecks: vi.fn(),
    move: vi.fn(async () => ok()),
    suspend: vi.fn(async () => ok()),
    setTags: vi.fn(async () => ok()),
    trash: vi.fn(async () => ok()),
  };
}

function domDoubles() {
  const search = { focus: vi.fn(), blur: vi.fn(), select: vi.fn() };
  const grid = { focus: vi.fn(), blur: vi.fn() };
  const bulk = { focus: vi.fn() };
  vi.stubGlobal('document', {
    getElementById: (id: string) => (id === 'browse-bulk' ? { querySelector: () => bulk } : null),
  });
  return { search, grid, bulk };
}

function harness() {
  const rows = sampleRows();
  let snap = baseSnap(rows);
  const patches: Partial<BrowseSnap>[] = [];
  const tasks: (() => Promise<void>)[] = [];
  const dom = domDoubles();
  const io: HandlerIo = {
    snap: () => snap,
    patch: (value) => {
      patches.push(value);
      snap = { ...snap, ...value };
    },
    keyInput: (region, event) => keyFrom(snap, region, event),
    searchField: () => dom.search as unknown as HTMLInputElement,
    grid: () => dom.grid as unknown as HTMLElement,
    client: okClient(),
    runBulk: (task) => {
      tasks.push(task);
    },
    finishWrite: vi.fn(async () => undefined),
    onSearch: vi.fn(),
  };
  return {
    io,
    handlers: createBrowseHandlers(io),
    snap: () => snap,
    setSnap: (next: BrowseSnap) => {
      snap = next;
    },
    patches,
    tasks,
    search: dom.search,
    grid: dom.grid,
    bulk: dom.bulk,
    rows,
  };
}

describe('browse handlers', () => {
  beforeEach(() => {
    goto.mockReset();
  });

  it('handles the search field keys', () => {
    const { handlers, io, patches } = harness();
    const enter = keyEvent('Enter');
    handlers.onQueryKey(enter);
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(io.onSearch).toHaveBeenCalledOnce();
    handlers.onQueryKey(keyEvent('Escape'));
    expect(patches.at(-1)).toEqual({ query: '' });
    const box = harness();
    box.setSnap({ ...box.snap(), query: '' });
    box.handlers.onQueryKey(keyEvent('Escape'));
    expect(box.search.blur).toHaveBeenCalled();
    box.handlers.onQueryKey(keyEvent('a', { ctrlKey: true }));
    expect(box.search.select).toHaveBeenCalled();
    box.handlers.onQueryKey(keyEvent('g'));
    expect(box.patches).toHaveLength(0);
  });

  it('moves, toggles, opens, and selects on the grid', async () => {
    const { handlers, patches, grid, bulk, search } = harness();
    handlers.onGridKey(keyEvent('ArrowDown'));
    expect(patches.at(-1)).toEqual({ active: 1 });
    handlers.onGridKey(keyEvent(' '));
    expect(patches.at(-1)?.selected).toEqual([CARD_A, CARD_B]);
    handlers.onGridKey(keyEvent('Enter'));
    expect(goto).toHaveBeenCalledWith('/notes/' + NOTE_B);
    handlers.onGridKey(keyEvent('Tab'));
    expect(bulk.focus).toHaveBeenCalled();
    handlers.onGridKey(keyEvent('Tab', { shiftKey: true }));
    expect(search.focus).toHaveBeenCalled();
    handlers.onGridKey(keyEvent('Escape'));
    expect(patches.at(-1)).toEqual({ selected: [] });
    handlers.onGridKey(keyEvent('a', { ctrlKey: true }));
    expect(patches.at(-1)?.selected).toEqual([CARD_A, CARD_B, CARD_C]);
    handlers.onGridKey(keyEvent('Escape'));
    handlers.onGridKey(keyEvent('Escape'));
    expect(grid.blur).toHaveBeenCalled();
    handlers.onGridKey(keyEvent('1'));
    handlers.onPick(2);
    expect(grid.focus).toHaveBeenCalled();
    handlers.onCheck(CARD_C, 2);
    expect(patches.at(-1)?.active).toBe(2);
  });

  it('does not open a bad note id', () => {
    const { handlers, setSnap, snap } = harness();
    setSnap({
      ...snap(),
      rows: [{ ...snap().rows[0], noteId: 'bad', cardId: CARD_A } as BrowseView],
      active: 0,
    });
    handlers.onGridKey(keyEvent('Enter'));
    expect(goto).not.toHaveBeenCalled();
  });

  it('captures the first selection and does not start a second write', async () => {
    const { handlers, io, tasks, setSnap, snap } = harness();
    handlers.onMove();
    setSnap({ ...snap(), selected: [CARD_B] });
    handlers.onMove();
    expect(tasks).toHaveLength(2);
    await tasks[0]?.();
    expect(io.client.move).toHaveBeenCalledWith([CARD_A], DECK);
    expect(io.client.move).not.toHaveBeenCalledWith([CARD_B], DECK);
    setSnap({ ...snap(), modalOpen: true });
    const before = tasks.length;
    handlers.onSuspend();
    handlers.onAdd();
    expect(tasks).toHaveLength(before);
  });

  it('sends tag, suspend, and trash bodies from the current snap', async () => {
    const { handlers, io, tasks, setSnap, snap } = harness();
    handlers.onAdd();
    handlers.onRemove();
    handlers.onSuspend();
    handlers.onConfirmDelete();
    await Promise.all(tasks.map((task) => task()));
    expect(io.client.setTags).toHaveBeenCalledWith({
      noteIds: [NOTE_A],
      add: ['pets'],
      remove: [],
    });
    expect(io.client.setTags).toHaveBeenCalledWith({
      noteIds: [NOTE_A],
      add: [],
      remove: ['pets'],
    });
    expect(io.client.suspend).toHaveBeenCalledWith([CARD_A]);
    expect(io.client.trash).toHaveBeenCalledWith([NOTE_A]);
    setSnap({ ...snap(), tagText: 'bad tag', selected: [] });
    const count = tasks.length;
    handlers.onAdd();
    handlers.onMove();
    handlers.onSuspend();
    handlers.onConfirmDelete();
    expect(tasks).toHaveLength(count);
  });

  it('opens and closes the delete dialog', () => {
    const { handlers, patches, setSnap, snap } = harness();
    handlers.onDelete();
    expect(patches.at(-1)).toEqual({ message: '', modalOpen: true });
    handlers.onCloseDelete();
    expect(patches.at(-1)).toEqual({ modalOpen: false });
    setSnap({ ...snap(), busy: true, selected: [] });
    const count = patches.length;
    handlers.onDelete();
    handlers.onCloseDelete();
    expect(patches).toHaveLength(count);
  });

  it('skips bulk focus when the bar is missing', () => {
    const { handlers } = harness();
    vi.stubGlobal('document', { getElementById: () => null });
    expect(() => handlers.onGridKey(keyEvent('Tab'))).not.toThrow();
  });
});
