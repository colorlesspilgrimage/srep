import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { fail } from '#lib/server/auth/deps.js';
import {
  BASIC_CARD_ID,
  BUILTIN_NOTE_TYPES,
  BUILTIN_PRESET,
  DEFAULT_PRESET_ID,
} from '#lib/server/domain/builtin.js';
import { planDeckUpdate } from '#lib/server/domain/core/deck-paths.js';
import { defineNoteStoreSuite } from '#lib/server/domain/store/store-notes.suite.js';
import {
  addNote,
  deckRow,
  execSql,
  noteRow,
  type MakeHarness,
} from '#lib/server/domain/store/suite-support.js';
import type { DomainHarness } from '#lib/server/domain/test-support/harness.js';

// One suite for every dialect. SQLite runs always. Postgres runs when a URL is set.
export function defineDomainStoreSuite(make: MakeHarness): void {
  let h: DomainHarness | undefined;
  afterEach(async () => {
    await h?.close();
    h = undefined;
  });
  async function open(): Promise<DomainHarness> {
    h = await make();
    return h;
  }

  describe('seed', () => {
    it('is idempotent and does not overwrite an edited default preset', async () => {
      const { store } = await open();
      expect(await store.updatePreset({ ...BUILTIN_PRESET, name: 'Mine', newPerDay: 5 })).toBe(
        'ok',
      );
      await store.seedDefaults({ preset: BUILTIN_PRESET, noteTypes: BUILTIN_NOTE_TYPES });
      expect(await store.listPresets()).toEqual([
        { ...BUILTIN_PRESET, name: 'Mine', newPerDay: 5 },
      ]);
      const types = await store.listNoteTypes();
      expect(types.map((t) => t.name)).toEqual(['Basic', 'Basic+Reversed', 'Cloze']);
      expect(types.map((t) => t.templates.length)).toEqual([1, 2, 1]);
    });
  });

  describe('presets', () => {
    const preset = { ...BUILTIN_PRESET, id: 'p2', name: 'Fast', fsrsParams: Array(19).fill(0.5) };

    it('inserts, refuses a duplicate name, updates and deletes', async () => {
      const { store } = await open();
      expect(await store.insertPreset(preset)).toBe('ok');
      expect(await store.insertPreset({ ...preset, id: 'p3' })).toBe('name_taken');
      expect(await store.getPreset('p2')).toEqual(preset);
      expect(await store.updatePreset({ ...preset, name: 'Default' })).toBe('name_taken');
      expect(await store.updatePreset({ ...preset, fsrsParams: null })).toBe('ok');
      expect((await store.getPreset('p2'))?.fsrsParams).toBeNull();
      expect(await store.updatePreset({ ...preset, id: 'nope' })).toBe('not_found');
      expect(await store.deletePresetUnlessUsed('p2')).toBe('deleted');
      expect(await store.deletePresetUnlessUsed('p2')).toBe('not_found');
    });

    it('refuses to delete a preset in use', async () => {
      const { store } = await open();
      await store.insertPreset(preset);
      await store.insertDeck({ ...deckRow('d', 'D'), presetId: 'p2' });
      expect(await store.deletePresetUnlessUsed('p2')).toBe('in_use');
      expect(await store.deletePresetUnlessUsed(DEFAULT_PRESET_ID)).toBe('deleted');
    });
  });

  describe('decks', () => {
    async function tree(h: DomainHarness) {
      const a = deckRow('a', 'A');
      const b = deckRow('b', 'B', a);
      const c = deckRow('c', 'C', b);
      const x = deckRow('x', 'X');
      for (const d of [a, b, c, x]) {
        expect(await h.store.insertDeck(d)).toBe('ok');
      }
      return { a, b, c, x };
    }
    const paths = async (h: DomainHarness) => (await h.store.listDecks()).map((d) => d.path);

    it('inserts, lists by path and refuses a duplicate path', async () => {
      const hh = await open();
      await tree(hh);
      expect(await hh.store.insertDeck(deckRow('a2', 'A'))).toBe('name_taken');
      expect(await paths(hh)).toEqual(['A', 'A::B', 'A::B::C', 'X']);
      expect((await hh.store.getDeck('b'))?.parentId).toBe('a');
    });

    it('renames with descendants in one transaction', async () => {
      const hh = await open();
      await tree(hh);
      const result = await hh.store.changeDecks((all) => planDeckUpdate(all, 'a', { name: 'L' }));
      expect(result.ok && result.updates.length).toBe(3);
      expect(await paths(hh)).toEqual(['L', 'L::B', 'L::B::C', 'X']);
    });

    it('changes nothing for a failure, and rolls back a clash in the middle', async () => {
      const hh = await open();
      const { a, b, c } = await tree(hh);
      expect(await hh.store.changeDecks(() => fail(409, 'deck_cycle'))).toEqual(
        fail(409, 'deck_cycle'),
      );
      const clash = await hh.store.changeDecks(() => ({
        ok: true,
        updates: [
          { ...a, name: 'Q', path: 'Q' },
          { ...b, path: 'Q::B' },
          { ...c, path: 'X' },
        ],
      }));
      expect(clash).toEqual(fail(409, 'deck_name_taken'));
      expect(await paths(hh)).toEqual(['A', 'A::B', 'A::B::C', 'X']);
    });

    it('counts the impact of a subtree', async () => {
      const hh = await open();
      await tree(hh);
      await addNote(hh, 'n1', ['b', 'x']);
      await addNote(hh, 'n2', ['c', 'c']);
      expect(await hh.store.deckImpact('a')).toEqual({ decks: 3, cards: 3, notes: 2 });
      expect(await hh.store.deckImpact('nope')).toBeUndefined();
    });

    it('deletes a tree and moves its cards', async () => {
      const hh = await open();
      await tree(hh);
      await addNote(hh, 'n1', ['c']);
      expect(await hh.store.deleteDeckTree('a', { kind: 'move', targetDeckId: 'b' }, 9)).toBe(
        'target_in_subtree',
      );
      expect(await hh.store.deleteDeckTree('a', { kind: 'move', targetDeckId: 'zz' }, 9)).toBe(
        'target_not_found',
      );
      expect(await hh.store.deleteDeckTree('zz', { kind: 'trash' }, 9)).toBe('not_found');
      expect(await hh.store.deleteDeckTree('a', { kind: 'move', targetDeckId: 'x' }, 9)).toBe('ok');
      expect(await paths(hh)).toEqual(['X']);
      expect((await hh.store.getNoteState('n1'))?.cards[0]?.deckId).toBe('x');
    });

    it('deletes a tree and trashes its notes', async () => {
      const hh = await open();
      await tree(hh);
      await addNote(hh, 'n1', ['c', 'x']);
      await addNote(hh, 'n2', ['x']);
      expect(await hh.store.deleteDeckTree('a', { kind: 'trash' }, 9)).toBe('ok');
      const n1 = await hh.store.getNoteState('n1');
      expect(n1?.note.deletedAt).toBe(9);
      expect(n1?.cards.map((c) => c.deckId)).toEqual([null, 'x']);
      expect((await hh.store.getNoteState('n2'))?.note.deletedAt).toBeNull();
    });

    it('handles names with %, _, \\, quote and emoji (CWE-89)', async () => {
      const hh = await open();
      const names = ['A%', 'AB', 'A_', "O'Neil", 'A\\', '😀🎌'];
      const rows = names.map((n, i) => deckRow(`s${i}`, n));
      const child = deckRow('kid', '😀', rows[5] ?? null);
      for (const d of [...rows, child]) {
        await hh.store.insertDeck(d);
      }
      const result = await hh.store.changeDecks((all) => planDeckUpdate(all, 's5', { name: '%_' }));
      expect(result.ok && result.updates.map((d) => d.path)).toEqual(['%_', '%_::😀']);
      expect(await hh.store.deleteDeckTree('s0', { kind: 'trash' }, 1)).toBe('ok');
      // Postgres sorts by locale. Compare as sets.
      expect((await paths(hh)).sort()).toEqual(
        ['%_', '%_::😀', 'A\\', 'AB', 'A_', "O'Neil"].sort(),
      );
    });
  });

  describe('note types', () => {
    const nt = { id: 'nt', name: 'Vocab', fields: ['W'], cssClass: 'custom', sortFieldIdx: 0 };
    const tpl = {
      id: 'tp',
      noteTypeId: 'nt',
      name: 'C',
      ordinal: 0,
      frontTpl: '{{W}}',
      backTpl: '',
    };

    it('inserts with templates, refuses a duplicate name, deletes when unused', async () => {
      const { store } = await open();
      expect(await store.insertNoteType(nt, [tpl])).toBe('ok');
      expect(await store.insertNoteType({ ...nt, id: 'nt2' }, [])).toBe('name_taken');
      expect(await store.getNoteType('nt')).toEqual({ ...nt, templates: [tpl] });
      expect(await store.deleteNoteTypeUnlessUsed('nt')).toBe('deleted');
      expect(await store.getNoteType('nt')).toBeUndefined();
      expect(await store.deleteNoteTypeUnlessUsed('nt')).toBe('not_found');
    });

    it('refuses to delete a type in use, also by a trashed note', async () => {
      const hh = await open();
      await hh.store.insertNoteType(nt, [tpl]);
      await hh.store.insertDeck(deckRow('d', 'D'));
      await hh.store.insertNote({
        note: noteRow('n', { noteTypeId: 'nt' }),
        tags: [],
        cards: [{ id: 'c', templateId: 'tp', ordinal: 0, deckId: 'd' }],
        now: 1,
      });
      await hh.store.trashNote('n', 2);
      expect(await hh.store.deleteNoteTypeUnlessUsed('nt')).toBe('in_use');
    });
  });

  describe('media', () => {
    const row = { id: 'm1', sha256: 'a'.repeat(64), mime: 'image/png', size: 3, originalName: 'x' };

    it('keeps the first row for a sha and finds missing shas', async () => {
      const { store } = await open();
      expect(await store.insertMediaIfAbsent(row)).toEqual(row);
      expect(await store.insertMediaIfAbsent({ ...row, id: 'm2', originalName: 'y' })).toEqual(row);
      expect(await store.getMediaBySha(row.sha256)).toEqual(row);
      const other = 'b'.repeat(64);
      expect(await store.findMissingMedia([row.sha256, other, other])).toEqual([other]);
      expect(await store.findMissingMedia([])).toEqual([]);
    });
  });

  describe('foreign keys', () => {
    it('refuses a card for an unknown note, and a note for an unknown type', async () => {
      const hh = await open();
      await hh.store.insertDeck(deckRow('d', 'D'));
      const card = execSql(
        hh,
        sql`insert into card (id, note_id, template_id, ordinal, deck_id, state, due, stability,
          difficulty, reps, lapses, position, flags)
          values ('c', 'nope', ${BASIC_CARD_ID}, 0, 'd', 'new', 1, 0, 0, 0, 0, 0, 0)`,
      );
      await expect(card).rejects.toThrow();
      const bad = hh.store.insertNote({
        note: noteRow('n', { noteTypeId: 'missing' }),
        tags: [],
        cards: [{ id: 'c', templateId: BASIC_CARD_ID, ordinal: 0, deckId: 'd' }],
        now: 1,
      });
      await expect(bad).rejects.toThrow();
      expect(await hh.store.getNoteState('n')).toBeUndefined();
    });
  });

  defineNoteStoreSuite(make);
}
