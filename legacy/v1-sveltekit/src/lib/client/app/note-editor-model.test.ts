import { describe, expect, it } from 'vitest';
import {
  DUPLICATE_NOTE_TEXT,
  duplicateText,
  PREVIEW_FAILED_TEXT,
  previewDecision,
  fieldsForCount,
  insertSlice,
  joinTags,
  mediaToken,
  nextSerial,
  pickBasicTypeId,
  pickDeckIndex,
  previewIsCurrent,
  splitTags,
} from './note-editor-model.js';

const SHA = 'ab'.repeat(32);

describe('note editor model', () => {
  it('splits tags on white space and joins them with one space', () => {
    expect(splitTags(' animals  zoo\nvocab ')).toEqual(['animals', 'zoo', 'vocab']);
    expect(splitTags('')).toEqual([]);
    expect(splitTags('   ')).toEqual([]);
    expect(joinTags(['b', 'a'])).toBe('b a');
  });

  it('tracks the preview serial and inserts a media token', () => {
    expect(nextSerial(4)).toBe(5);
    expect(previewIsCurrent(2, 2)).toBe(true);
    expect(previewIsCurrent(1, 2)).toBe(false);
    const slow = previewDecision({
      alive: true,
      mine: 1,
      serial: 2,
      ok: true,
      cards: ['SLOW'],
    });
    const fast = previewDecision({
      alive: true,
      mine: 2,
      serial: 2,
      ok: true,
      cards: ['FAST'],
    });
    expect(slow).toEqual({ type: 'ignore' });
    expect(fast).toEqual({ type: 'cards', cards: ['FAST'] });
    expect(previewDecision({ alive: true, mine: 2, serial: 2, ok: false, cards: null })).toEqual({
      type: 'error',
    });
    expect(previewDecision({ alive: false, mine: 2, serial: 2, ok: false, cards: null })).toEqual({
      type: 'ignore',
    });
    expect(PREVIEW_FAILED_TEXT).toBe('The preview failed.');
    expect(insertSlice('gato', 4, 4, '{{media:x}}')).toBe('gato{{media:x}}');
    expect(insertSlice('hello', 1, 4, 'i')).toBe('hio');
    expect(insertSlice('ab', -1, 9, 'Z')).toBe('Z');
    expect(insertSlice('ab', 1.5, 1.5, 'Z')).toBe('Zab');
    expect(mediaToken(SHA)).toBe(`{{media:${SHA}}}`);
    expect(mediaToken('zz')).toBeNull();
    expect(mediaToken(SHA.toUpperCase())).toBeNull();
  });

  it('picks Basic, a deck, field slots, and the duplicate sentence', () => {
    expect(duplicateText([])).toBe('');
    expect(duplicateText(['n1'])).toBe(DUPLICATE_NOTE_TEXT);
    expect(fieldsForCount(['a'], 2)).toEqual(['a', '']);
    expect(fieldsForCount(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
    expect(fieldsForCount(['a'], -1)).toEqual([]);
    expect(fieldsForCount(['a'], 1.2)).toEqual([]);
    expect(pickBasicTypeId([])).toBeNull();
    expect(
      pickBasicTypeId([
        { id: 'c', name: 'Cloze' },
        { id: 'b', name: 'Basic' },
      ]),
    ).toBe('b');
    expect(pickBasicTypeId([{ id: 'c', name: 'Cloze' }])).toBe('c');
    expect(pickDeckIndex([{ id: 'a' }, { id: 'b' }], null)).toBe(0);
    expect(pickDeckIndex([{ id: 'a' }, { id: 'b' }], 'b')).toBe(1);
    expect(pickDeckIndex([{ id: 'a' }], 'missing')).toBe(0);
  });
});
