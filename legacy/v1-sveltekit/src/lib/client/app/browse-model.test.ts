import { describe, expect, it } from 'vitest';
import {
  BAD_QUERY_TEXT,
  CARD_CAP_TEXT,
  MAX_MOVE_CARDS,
  MAX_TAG_NOTES,
  NOTE_CAP_TEXT,
  NOT_FOUND_TEXT,
  browseNotePath,
  browseSearchPath,
  cardCapText,
  indexOfCard,
  keptSelection,
  moveAllowed,
  moveBody,
  noteCapText,
  noteWriteAllowed,
  pageCardIds,
  parseBrowsePage,
  parseDeckList,
  rowIndexAfter,
  searchEffect,
  selectedCardIds,
  selectedNoteIds,
  suspendBody,
  tagBody,
  tagIsSendable,
  toggleCard,
  trashBody,
  writeMessage,
  type BrowseView,
} from './browse-model.js';

const CARD_A = '123e4567-e89b-42d3-a456-000000000001';
const CARD_B = '123e4567-e89b-42d3-a456-000000000002';
const NOTE_A = '123e4567-e89b-42d3-a456-000000000011';
const NOTE_B = '123e4567-e89b-42d3-a456-000000000012';
const DECK = '123e4567-e89b-42d3-a456-000000000021';

function row(patch: Partial<BrowseView> = {}): BrowseView {
  return {
    cardId: CARD_A,
    noteId: NOTE_A,
    deckId: DECK,
    deckPath: 'Spanish',
    state: 'new',
    lapses: 0,
    frontText: 'gato',
    tags: 'animals',
    ...patch,
  };
}

function idAt(index: number): string {
  return `123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function raw(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cardId: CARD_A,
    noteId: NOTE_A,
    deckId: DECK,
    deckPath: 'Spanish',
    state: 'new',
    lapses: 0,
    frontText: 'gato',
    tags: ['animals'],
    ...patch,
  };
}

describe('browse paths', () => {
  it('encodes the query with URLSearchParams', () => {
    const params = new URLSearchParams();
    params.set('q', 'tag:animals');
    expect(browseSearchPath('tag:animals')).toBe(`/api/browse?${params.toString()}`);
    const hostile = '<script>alert(1)</script>';
    const path = browseSearchPath(hostile);
    expect(path).not.toContain('<');
    expect(path).toContain('q=');
    expect(browseSearchPath('a'.repeat(501))).toBeNull();
    expect(browseSearchPath('a\u0000')).toBeNull();
    expect(browseSearchPath('')).toBe('/api/browse?q=');
    expect(browseSearchPath('tag:a', 'javascript:alert(1)')).toBeNull();
    expect(browseSearchPath('tag:a', '../notes')).toBeNull();
    const withCursor = browseSearchPath('tag:a', CARD_A);
    expect(withCursor).toContain('cursor=');
    expect(withCursor).not.toContain('javascript');
    expect(new URLSearchParams(withCursor?.split('?')[1]).get('cursor')).toBe(CARD_A);
  });

  it('encodes a note id and rejects a bad id', () => {
    expect(browseNotePath(NOTE_A)).toBe(`/notes/${encodeURIComponent(NOTE_A)}`);
    expect(browseNotePath('../x')).toBeNull();
    expect(browseNotePath('constructor')).toBeNull();
  });
});

describe('browse rows', () => {
  it('keeps hostile front text as text and drops a bad page', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const page = parseBrowsePage({ rows: [raw({ frontText: hostile, tags: ['<script>'] })] });
    expect(page?.[0]?.frontText).toBe(hostile);
    expect(page?.[0]?.tags).toBe('<script>');
    expect(parseBrowsePage({ rows: 'nope' })).toBeNull();
    expect(parseBrowsePage({ rows: [raw({ cardId: 'bad' })] })).toBeNull();
    expect(parseBrowsePage({ rows: [raw(), raw()] })).toBeNull();
    expect(parseBrowsePage(null)).toBeNull();
    expect(parseBrowsePage({ rows: [raw({ lapses: 1.5 })] })).toBeNull();
    expect(parseBrowsePage({ rows: [raw({ deckId: '' })] })?.[0]?.deckId).toBe('');
    const rtl = 'א\u202e<script>alert(1)</script>';
    const shown = parseBrowsePage({
      rows: [raw({ frontText: rtl, deckPath: rtl, tags: [rtl] })],
      nextCursor: 'javascript:alert(1)',
    });
    expect(shown?.[0]?.frontText).toBe(rtl);
    expect(shown?.[0]?.deckPath).toBe(rtl);
    expect(shown?.[0]?.tags).toBe(rtl);
    expect(JSON.stringify(shown)).not.toContain('nextCursor');
    const huge = 'x'.repeat(501);
    expect(parseBrowsePage({ rows: [raw({ frontText: huge })] })?.[0]?.frontText).toHaveLength(500);
    expect(
      parseBrowsePage({ rows: [raw({ tags: Array.from({ length: 101 }, () => 'ok') })] }),
    ).toBeNull();
  });

  it('keeps the new card when the old card leaves the page', () => {
    const next = [row({ cardId: CARD_B, noteId: NOTE_B, frontText: 'perro' })];
    expect(indexOfCard(next, CARD_A)).toBe(0);
    expect(keptSelection(next, [CARD_A])).toEqual([]);
    expect(next[0]?.frontText).toBe('perro');
    expect(indexOfCard(next, CARD_B)).toBe(0);
    expect(indexOfCard(next, null)).toBe(0);
  });
});

describe('browse decks and caps', () => {
  it('sorts decks and skips an archived deck', () => {
    const decks = parseDeckList({
      decks: [
        { id: DECK, path: 'Spanish', archivedAt: null },
        { id: NOTE_A, path: 'French', archivedAt: null },
        { id: NOTE_B, path: 'Old', archivedAt: 1 },
        { id: 'bad', path: 'Nope', archivedAt: null },
      ],
    });
    expect(decks).toEqual([
      { id: NOTE_A, name: 'French' },
      { id: DECK, name: 'Spanish' },
    ]);
    expect(parseDeckList({})).toBeNull();
  });

  it('blocks move above 500 cards and tags above 100 notes', () => {
    expect(moveAllowed(MAX_MOVE_CARDS)).toBe(true);
    expect(moveAllowed(MAX_MOVE_CARDS + 1)).toBe(false);
    expect(moveAllowed(0)).toBe(false);
    expect(noteWriteAllowed(MAX_TAG_NOTES)).toBe(true);
    expect(noteWriteAllowed(MAX_TAG_NOTES + 1)).toBe(false);
    expect(cardCapText(MAX_MOVE_CARDS)).toBe('');
    expect(cardCapText(MAX_MOVE_CARDS + 1)).toBe(CARD_CAP_TEXT);
    expect(noteCapText(MAX_TAG_NOTES + 1)).toBe(NOTE_CAP_TEXT);
    expect(BAD_QUERY_TEXT).toBe('The search is not valid.');
  });
});

describe('browse writes', () => {
  it('uses the not-found sentence and ignores a prototype key', () => {
    expect(writeMessage('not_found')).toBe(NOT_FOUND_TEXT);
    expect(writeMessage('bad_request')).toBe('The request is not valid.');
    expect(writeMessage('network_error')).toBe('The server did not answer.');
    expect(writeMessage('constructor')).toBe('The request failed.');
    expect(writeMessage('toString')).toBe('The request failed.');
  });

  it('builds a tag body and rejects a bad tag or a bad id', () => {
    expect(tagIsSendable(' <script> ')).toBe(true);
    expect(tagIsSendable('pets dogs')).toBe(false);
    expect(tagIsSendable('a\u0000')).toBe(false);
    expect(tagBody([NOTE_A], ' pets ', 'add')).toEqual({
      noteIds: [NOTE_A],
      add: ['pets'],
      remove: [],
    });
    expect(tagBody([NOTE_A], 'pets', 'remove')).toEqual({
      noteIds: [NOTE_A],
      add: [],
      remove: ['pets'],
    });
    expect(tagBody([NOTE_A], 'pets dogs', 'add')).toBeNull();
    expect(tagBody(['bad'], 'pets', 'add')).toBeNull();
    expect(
      tagBody(
        Array.from({ length: 101 }, (_, index) => idAt(index + 1)),
        'pets',
        'add',
      ),
    ).toBeNull();
    expect(moveBody([CARD_A], DECK)).toEqual({ cardIds: [CARD_A], deckId: DECK });
    expect(moveBody([CARD_A], 'bad')).toBeNull();
    expect(moveBody([CARD_A, CARD_A], DECK)).toBeNull();
    expect(suspendBody([CARD_A])).toEqual({ cardIds: [CARD_A] });
    expect(suspendBody([])).toBeNull();
    expect(trashBody([NOTE_A])).toEqual({ noteIds: [NOTE_A] });
    expect(trashBody(['../x'])).toBeNull();
  });

  it('counts unique notes and toggles one card', () => {
    const rows = [row(), row({ cardId: CARD_B, noteId: NOTE_A })];
    expect(selectedNoteIds(rows, [CARD_A, CARD_B])).toEqual([NOTE_A]);
    expect(selectedCardIds(rows, [CARD_B, '123e4567-e89b-42d3-a456-000000000099'])).toEqual([
      CARD_B,
    ]);
    expect(pageCardIds(rows)).toEqual([CARD_A, CARD_B]);
    expect(toggleCard([CARD_A], CARD_B)).toEqual([CARD_A, CARD_B]);
    expect(toggleCard([CARD_A], CARD_A)).toEqual([]);
    expect(toggleCard([CARD_A], 'bad')).toEqual([CARD_A]);
    expect(rowIndexAfter(3, 2, 'next')).toBe(2);
    expect(rowIndexAfter(3, 0, 'prev')).toBe(0);
    expect(rowIndexAfter(0, 0, 'first')).toBe(0);
  });
});

describe('search effect', () => {
  it('keeps the newest serial and reports a bad query', () => {
    const rows = [row()];
    expect(searchEffect({ alive: true, mine: 1, serial: 2, ok: true, error: '', rows })).toEqual({
      type: 'ignore',
    });
    expect(searchEffect({ alive: false, mine: 2, serial: 2, ok: true, error: '', rows })).toEqual({
      type: 'ignore',
    });
    expect(
      searchEffect({ alive: true, mine: 2, serial: 2, ok: false, error: 'bad_query', rows: null }),
    ).toEqual({ type: 'bad-query' });
    expect(
      searchEffect({
        alive: true,
        mine: 2,
        serial: 2,
        ok: false,
        error: 'network_error',
        rows: null,
      }),
    ).toEqual({ type: 'error', message: 'The server did not answer.' });
    expect(
      searchEffect({ alive: true, mine: 2, serial: 2, ok: true, error: '', rows: null }),
    ).toEqual({ type: 'error', message: 'The request failed.' });
    expect(searchEffect({ alive: true, mine: 2, serial: 2, ok: true, error: '', rows })).toEqual({
      type: 'rows',
      rows,
    });
  });
});
