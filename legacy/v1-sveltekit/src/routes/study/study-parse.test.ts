import { describe, expect, it } from 'vitest';
import {
  cardTextFromNote,
  parseNextReply,
  parseNoteBody,
  readAnswerInterval,
} from '#lib/client/app/study-parse.js';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const NOTE = '223e4567-e89b-42d3-a456-426614174000';

const COUNTS = { new: 1, learning: 0, review: 2 };

function previews(minutes: number) {
  return { intervalMinutes: minutes };
}

function card() {
  return {
    id: ID,
    noteId: NOTE,
    reps: 0,
    front: 'gato',
    back: 'gato<hr>cat',
    previews: { 1: previews(1), 2: previews(6), 3: previews(10), 4: previews(11520) },
  };
}

describe('parseNextReply', () => {
  it('reads a card, a wait, and a done reply', () => {
    expect(parseNextReply({ status: 'card', card: card(), counts: COUNTS })).toMatchObject({
      status: 'card',
      card: { id: ID, reps: 0, front: 'gato', previews: { 4: 11520 } },
      counts: COUNTS,
    });
    expect(parseNextReply({ status: 'wait', until: 60_000, counts: COUNTS })).toEqual({
      status: 'wait',
      until: 60_000,
      counts: COUNTS,
    });
    expect(parseNextReply({ status: 'done', counts: COUNTS })).toEqual({
      status: 'done',
      counts: COUNTS,
    });
  });

  it('rejects a bad shape, a bad id, and a bad count', () => {
    expect(parseNextReply(null)).toBeNull();
    expect(parseNextReply([])).toBeNull();
    expect(parseNextReply({ status: 'card', counts: COUNTS })).toBeNull();
    expect(parseNextReply({ status: 'nope', counts: COUNTS })).toBeNull();
    expect(parseNextReply({ status: 'wait', until: Number.NaN, counts: COUNTS })).toBeNull();
    expect(
      parseNextReply({ status: 'done', counts: { new: -1, learning: 0, review: 0 } }),
    ).toBeNull();
    expect(
      parseNextReply({ status: 'done', counts: { new: 1.5, learning: 0, review: 0 } }),
    ).toBeNull();
    expect(parseNextReply({ status: 'done' })).toBeNull();
    const broken = card();
    broken.id = 'not-a-uuid';
    expect(parseNextReply({ status: 'card', card: broken, counts: COUNTS })).toBeNull();
    const script = card();
    script.front = '<script>alert(1)</script>';
    expect(parseNextReply({ status: 'card', card: script, counts: COUNTS })?.status).toBe('card');
  });
});

describe('parseNoteBody', () => {
  it('reads fields and finds the open card', () => {
    const body = {
      note: {
        fields: ['gato', 'cat'],
        cards: [{ id: ID, front: 'gato', back: 'gato<hr>cat' }],
      },
    };
    const note = parseNoteBody(body);
    expect(note?.fields).toEqual(['gato', 'cat']);
    expect(cardTextFromNote(note ?? { fields: [], cards: [] }, ID)).toEqual({
      front: 'gato',
      back: 'gato<hr>cat',
    });
    expect(cardTextFromNote(note ?? { fields: [], cards: [] }, NOTE)).toBeNull();
  });

  it('rejects a bad note and a field that is too long', () => {
    expect(parseNoteBody(null)).toBeNull();
    expect(parseNoteBody({ note: { fields: ['a\u0000'], cards: [] } })).toBeNull();
    expect(parseNoteBody({ note: { fields: 'gato', cards: [] } })).toBeNull();
    expect(
      parseNoteBody({ note: { fields: ['ok'], cards: [{ id: 'x', front: 'a', back: 'b' }] } }),
    ).toBeNull();
    expect(parseNoteBody({ fields: [] })).toBeNull();
    const huge = { note: { fields: ['a'.repeat(50_001)], cards: [] } };
    expect(parseNoteBody(huge)).toBeNull();
  });
});

describe('readAnswerInterval', () => {
  it('reads an integer interval and rejects a bad body', () => {
    expect(readAnswerInterval({ review: { intervalMinutes: 11520 } })).toBe(11520);
    expect(readAnswerInterval({ review: { intervalMinutes: 1.5 } })).toBeNull();
    expect(readAnswerInterval({})).toBeNull();
    expect(readAnswerInterval(null)).toBeNull();
  });
});
