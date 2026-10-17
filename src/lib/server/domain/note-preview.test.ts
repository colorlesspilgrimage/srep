import { afterEach, describe, expect, it } from 'vitest';
import { BASIC_ID, CLOZE_ID } from '#lib/server/domain/builtin.js';
import { createDeck } from '#lib/server/domain/decks.js';
import { createNoteType } from '#lib/server/domain/note-types.js';
import { previewNote, renderPreviewCards } from '#lib/server/domain/note-preview.js';
import { countRows } from '#lib/server/domain/store/suite-support.js';
import {
  createDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';
import { UNKNOWN_ID } from '#lib/server/domain/test-support/route-support.js';

let h: DomainHarness | undefined;

afterEach(async () => {
  await h?.close();
  h = undefined;
});

describe('previewNote', () => {
  it('renders a Basic card and does not insert a note or write media', async () => {
    h = await createDomainHarness();
    const before = await countRows(h, 'note');
    let writes = 0;
    const write = h.deps.media.write.bind(h.deps.media);
    h.deps.media.write = async (sha, bytes) => {
      writes += 1;
      await write(sha, bytes);
    };
    const result = await previewNote(h.deps, {
      noteTypeId: BASIC_ID,
      fields: ['<script>alert(1)</script>', 'cat'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.cards).toEqual([
      {
        templateName: 'Card 1',
        ordinal: 0,
        front: '<script>alert(1)</script>',
        back: '<script>alert(1)</script><hr>cat',
      },
    ]);
    expect(await countRows(h, 'note')).toBe(before);
    expect(writes).toBe(0);
    const again = await previewNote(h.deps, { noteTypeId: BASIC_ID, fields: ['gato', 'cat'] });
    expect(again.ok).toBe(true);
    expect(await countRows(h, 'note')).toBe(before);
  });

  it('renders a cloze gap and rejects a missing type or a bad field list', async () => {
    h = await createDomainHarness();
    const cloze = await previewNote(h.deps, {
      noteTypeId: CLOZE_ID,
      fields: ['{{c1::gato}}', 'extra'],
    });
    expect(cloze.ok && cloze.cards[0]?.front).toBe('<span class="cloze">[...]</span>');
    expect(await previewNote(h.deps, { noteTypeId: UNKNOWN_ID, fields: ['a', 'b'] })).toEqual({
      ok: false,
      status: 404,
      error: 'not_found',
    });
    expect(await previewNote(h.deps, { noteTypeId: BASIC_ID, fields: ['only'] })).toEqual({
      ok: false,
      status: 400,
      error: 'bad_request',
    });
    expect(await previewNote(h.deps, { noteTypeId: BASIC_ID, fields: ['a\u0000', 'b'] })).toEqual({
      ok: false,
      status: 400,
      error: 'bad_request',
    });
    const huge = 'x'.repeat(50_001);
    expect(await previewNote(h.deps, { noteTypeId: BASIC_ID, fields: [huge, 'b'] })).toEqual({
      ok: false,
      status: 400,
      error: 'bad_request',
    });
  });

  it('returns 400 when the render cost is too high and keeps the note count', async () => {
    h = await createDomainHarness();
    const deck = await createDeck(h.deps, { name: 'Main' });
    if (!deck.ok) {
      throw new Error(deck.error);
    }
    const refs = '{{cloze:T}}'.repeat(500);
    const created = await createNoteType(h.deps, {
      name: 'Costly',
      fields: ['T'],
      templates: [{ name: 'Card', front: refs, back: refs }],
    });
    if (!created.ok) {
      throw new Error(created.error);
    }
    const before = await countRows(h, 'note');
    const many = Array.from({ length: 100 }, (_, i) => `{{c${i + 1}::a}}`).join('');
    const result = await previewNote(h.deps, { noteTypeId: created.noteType.id, fields: [many] });
    expect(result).toEqual({ ok: false, status: 400, error: 'bad_request' });
    expect(await countRows(h, 'note')).toBe(before);
  });

  it('returns an empty card when the template id is missing', async () => {
    h = await createDomainHarness();
    const noteType = await h.deps.store.getNoteType(BASIC_ID);
    if (noteType === undefined) {
      throw new Error('missing type');
    }
    expect(
      renderPreviewCards(noteType, ['a', 'b'], [{ templateId: 'missing', ordinal: 4 }]),
    ).toEqual([{ templateName: '', ordinal: 4, front: '', back: '' }]);
  });
});
