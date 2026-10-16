import { describe, expect, it } from 'vitest';
import {
  applyEditedCard,
  applyNext,
  badDeck,
  beginAction,
  closeEdit,
  failedAction,
  failedLoad,
  initialStudyState,
  nothingToUndo,
  openEdit,
  phaseSide,
  phaseStatus,
  rateElapsed,
  rememberInterval,
  reveal,
} from '#lib/client/app/study-state.js';
import type { NextReply } from '#lib/client/app/study-parse.js';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const NOTE = '223e4567-e89b-42d3-a456-426614174000';
const COUNTS = { new: 1, learning: 0, review: 0 };

const cardReply: NextReply = {
  status: 'card',
  counts: COUNTS,
  card: {
    id: ID,
    noteId: NOTE,
    reps: 0,
    front: 'gato',
    back: 'gato<hr>cat',
    previews: { 1: 1, 2: 6, 3: 10, 4: 11520 },
  },
};

describe('study state', () => {
  it('shows the front first and then the back', () => {
    const shown = applyNext(initialStudyState(), cardReply, 1000);
    expect(shown.phase).toMatchObject({ kind: 'card', side: 'front' });
    const back = reveal(shown);
    expect(back.phase).toMatchObject({ side: 'back' });
    expect(reveal(back)).toBe(back);
    expect(phaseStatus(shown.phase)).toBe('card');
    expect(phaseSide(shown.phase)).toBe('front');
  });

  it('stores the last interval for the done screen', () => {
    const rated = rememberInterval(initialStudyState(), 11520);
    const done = applyNext(
      rated,
      { status: 'done', counts: { new: 0, learning: 0, review: 0 } },
      0,
    );
    expect(done.phase).toEqual({
      kind: 'done',
      dueText: '8d',
      counts: { new: 0, learning: 0, review: 0 },
    });
    expect(rememberInterval(rated, null).lastInterval).toBe(11520);
    const empty = applyNext(initialStudyState(), { status: 'done', counts: COUNTS }, 0);
    expect(empty.phase).toMatchObject({ kind: 'done', dueText: '0m' });
  });

  it('formats a wait time and a bad deck', () => {
    const wait = applyNext(
      initialStudyState(),
      { status: 'wait', until: Date.parse('2026-01-01T09:01:00Z'), counts: COUNTS },
      0,
    );
    expect(wait.phase.kind).toBe('wait');
    if (wait.phase.kind === 'wait') {
      expect(wait.phase.untilText.length).toBeGreaterThan(0);
    }
    expect(phaseStatus(wait.phase)).toBe('wait');
    expect(phaseSide(wait.phase)).toBe('front');
    expect(badDeck(initialStudyState()).phase.kind).toBe('bad-deck');
    expect(failedLoad(initialStudyState(), 'not_found').phase).toEqual({
      kind: 'error',
      message: 'That deck was not found.',
    });
    expect(phaseStatus({ kind: 'loading' })).toBe('done');
    expect(phaseStatus({ kind: 'error', message: 'x' })).toBe('done');
  });

  it('blocks a second action and records undo and edit text', () => {
    const shown = applyNext(initialStudyState(), cardReply, 1000);
    const busy = beginAction(shown);
    expect(busy?.busy).toBe(true);
    expect(beginAction(busy ?? shown)).toBeNull();
    expect(reveal(busy ?? shown)).toBe(busy);
    expect(nothingToUndo(busy ?? shown).message).toBe('Nothing to undo.');
    expect(failedAction(busy ?? shown, 'network_error').message).toBe('The server did not answer.');
    expect(rateElapsed(shown, 1600)).toBe(600);
    const editing = openEdit(shown);
    expect(editing.editOpen).toBe(true);
    expect(openEdit(busy ?? shown).editOpen).toBe(false);
    const saved = applyEditedCard(editing, 'gato2', 'gato2<hr>cat');
    expect(saved.editOpen).toBe(false);
    expect(saved.phase).toMatchObject({ card: { front: 'gato2' } });
    expect(closeEdit(editing).editOpen).toBe(false);
    expect(applyEditedCard(initialStudyState(), 'a', 'b').phase.kind).toBe('loading');
  });
});
