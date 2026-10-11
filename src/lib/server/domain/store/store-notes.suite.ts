import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { fail } from '#lib/server/auth/deps.js';
import { FLAG_ORPHANED } from '#lib/server/domain/core/card-plan.js';
import type { NoteChange, NoteState } from '#lib/server/domain/store/store-types.js';
import {
  addNote,
  countRows,
  deckRow,
  draft,
  execSql,
  insertReviewLog,
  type MakeHarness,
} from '#lib/server/domain/store/suite-support.js';
import type { DomainHarness } from '#lib/server/domain/test-support/harness.js';

function change(state: NoteState, extra: Partial<Extract<NoteChange, { ok: true }>>): NoteChange {
  return {
    ok: true,
    fields: state.note.fields,
    checksum: state.note.checksum,
    updatedAt: 50,
    tags: state.tags,
    create: [],
    deleteIds: [],
    orphanIds: [],
    unorphanIds: [],
    ...extra,
  };
}

export function defineNoteStoreSuite(make: MakeHarness): void {
  let h: DomainHarness | undefined;
  afterEach(async () => {
    await h?.close();
    h = undefined;
  });
  async function open(): Promise<DomainHarness> {
    h = await make();
    for (const d of [deckRow('d1', 'D1'), deckRow('d2', 'D2')]) {
      await h.store.insertDeck(d);
    }
    return h;
  }

  describe('notes', () => {
    it('stores tags and gives increasing positions across notes', async () => {
      const hh = await open();
      await addNote(hh, 'n1', ['d1', 'd1']);
      await addNote(hh, 'n2', ['d2']);
      const n1 = await hh.store.getNoteState('n1');
      const n2 = await hh.store.getNoteState('n2');
      expect(n1?.tags).toEqual(['t']);
      expect(n1?.cards.map((c) => c.position)).toEqual([0, 1]);
      expect(n2?.cards.map((c) => c.position)).toEqual([2]);
      expect(n1?.cards[0]).toMatchObject({ state: 'new', due: 5, reps: 0, flags: 0, deckId: 'd1' });
      expect(await hh.store.getNoteState('missing')).toBeUndefined();
    });

    it('updates fields and tags, creates, deletes and orphans cards', async () => {
      const hh = await open();
      await addNote(hh, 'n', ['d1', 'd1', 'd1']);
      const result = await hh.store.updateNote('n', (state) =>
        change(state, {
          fields: ['x', 'y'],
          checksum: 'new',
          tags: ['a', 'b'],
          create: [draft('n-new', 'd2', 7)],
          deleteIds: ['n-c0'],
          orphanIds: ['n-c1'],
        }),
      );
      expect(result).toEqual({ ok: true });
      const state = await hh.store.getNoteState('n');
      expect(state?.note).toMatchObject({ fields: ['x', 'y'], checksum: 'new', updatedAt: 50 });
      expect(state?.tags).toEqual(['a', 'b']);
      expect(state?.cards.map((c) => [c.id, c.state, c.flags, c.position])).toEqual([
        ['n-c1', 'suspended', FLAG_ORPHANED, 1],
        ['n-c2', 'new', 0, 2],
        ['n-new', 'new', 0, 3],
      ]);
      await hh.store.updateNote('n', (s) => change(s, { unorphanIds: ['n-c1'] }));
      const back = (await hh.store.getNoteState('n'))?.cards[0];
      expect(back).toMatchObject({ id: 'n-c1', state: 'suspended', flags: 0 });
    });

    it('gives not_found for a trashed note and rolls back a failing compute', async () => {
      const hh = await open();
      await addNote(hh, 'n', ['d1']);
      expect(await hh.store.updateNote('n', () => fail(400, 'deck_required'))).toEqual(
        fail(400, 'deck_required'),
      );
      expect((await hh.store.getNoteState('n'))?.note.updatedAt).toBe(1);
      await hh.store.trashNote('n', 9);
      expect(await hh.store.updateNote('n', (s) => change(s, {}))).toBe('not_found');
      expect(await hh.store.updateNote('missing', (s) => change(s, {}))).toBe('not_found');
    });

    it('rolls back all writes when a later write fails', async () => {
      const hh = await open();
      await addNote(hh, 'n', ['d1']);
      const clash = hh.store.updateNote('n', (s) =>
        change(s, { tags: ['z'], create: [draft('dup', 'd1', 0)] }),
      );
      await expect(clash).rejects.toThrow();
      expect((await hh.store.getNoteState('n'))?.tags).toEqual(['t']);
    });

    it('finds live notes by checksum', async () => {
      const hh = await open();
      await addNote(hh, 'a', ['d1'], { checksum: 'same' });
      await addNote(hh, 'b', ['d1'], { checksum: 'same', createdAt: 2 });
      await addNote(hh, 'c', ['d1'], { checksum: 'same' });
      await hh.store.trashNote('c', 3);
      expect(await hh.store.findNoteIdsByChecksum('nope', 'same')).toEqual([]);
      const basic = (await hh.store.getNoteState('a'))?.note.noteTypeId ?? '';
      expect(await hh.store.findNoteIdsByChecksum(basic, 'same')).toEqual(['a', 'b']);
      expect(await hh.store.findNoteIdsByChecksum(basic, 'same', 'a')).toEqual(['b']);
    });

    it('trashes and restores a note', async () => {
      const hh = await open();
      await addNote(hh, 'n', ['d1']);
      expect(await hh.store.restoreNote('n', undefined, 3)).toBe('not_trashed');
      expect(await hh.store.trashNote('n', 2)).toBe(true);
      expect(await hh.store.trashNote('n', 2)).toBe(false);
      expect(await hh.store.restoreNote('n', undefined, 3)).toBe('ok');
      expect((await hh.store.getNoteState('n'))?.note).toMatchObject({
        deletedAt: null,
        updatedAt: 3,
      });
      expect(await hh.store.restoreNote('missing', undefined, 3)).toBe('not_found');
    });

    it('needs a deck to restore a note whose deck was deleted', async () => {
      const hh = await open();
      await addNote(hh, 'n', ['d1']);
      await hh.store.deleteDeckTree('d1', { kind: 'trash' }, 2);
      expect(await hh.store.restoreNote('n', undefined, 3)).toBe('deck_required');
      expect(await hh.store.restoreNote('n', 'zz', 3)).toBe('deck_not_found');
      expect(await hh.store.restoreNote('n', 'd2', 3)).toBe('ok');
      expect((await hh.store.getNoteState('n'))?.cards[0]?.deckId).toBe('d2');
    });

    it('moves cards all or nothing', async () => {
      const hh = await open();
      await addNote(hh, 'n', ['d1', 'd1']);
      expect(await hh.store.moveCards(['n-c0', 'unknown'], 'd2')).toBe('card_not_found');
      expect(await hh.store.moveCards(['n-c0'], 'zz')).toBe('deck_not_found');
      expect((await hh.store.getNoteState('n'))?.cards.map((c) => c.deckId)).toEqual(['d1', 'd1']);
      expect(await hh.store.moveCards(['n-c0', 'n-c1', 'n-c0'], 'd2')).toBe('ok');
      expect((await hh.store.getNoteState('n'))?.cards.map((c) => c.deckId)).toEqual(['d2', 'd2']);
    });

    it('purges old trash with its cards, tags and review logs, and keeps newer trash', async () => {
      const hh = await open();
      await addNote(hh, 'old', ['d1']);
      await addNote(hh, 'new', ['d1']);
      await addNote(hh, 'live', ['d1']);
      await insertReviewLog(hh, 'r1', 'old-c0');
      await insertReviewLog(hh, 'r2', 'live-c0');
      await hh.store.trashNote('old', 100);
      await hh.store.trashNote('new', 101);
      expect(await hh.store.purgeTrash(100)).toBe(1);
      expect(await hh.store.getNoteState('old')).toBeUndefined();
      expect(await hh.store.getNoteState('new')).toBeDefined();
      expect(await countRows(hh, 'card')).toBe(2);
      expect(await countRows(hh, 'note_tag')).toBe(2);
      expect(await countRows(hh, 'review_log')).toBe(1);
    });

    it('keeps review history when a card moves', async () => {
      const hh = await open();
      await addNote(hh, 'n', ['d1']);
      await execSql(
        hh,
        sql`update card set reps = 4, lapses = 1, stability = 2.5 where id = 'n-c0'`,
      );
      await hh.store.moveCards(['n-c0'], 'd2');
      const card = (await hh.store.getNoteState('n'))?.cards[0];
      expect(card).toMatchObject({ deckId: 'd2', reps: 4, lapses: 1, stability: 2.5, due: 5 });
    });
  });
}
