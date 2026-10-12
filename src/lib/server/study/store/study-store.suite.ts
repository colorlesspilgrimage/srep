import { afterEach, describe, expect, it } from 'vitest';
import { fail } from '#lib/server/auth/deps.js';
import { addNote, countRows } from '#lib/server/domain/store/suite-support.js';
import { shuffleKey } from '#lib/server/study/core/queue-choice.js';
import { defineStudyRaceSuite } from '#lib/server/study/store/study-store-race.suite.js';
import { defineStudyStateSuite } from '#lib/server/study/store/study-store-state.suite.js';
import {
  addDeckRow,
  answerVia,
  DAY_MS,
  insertLog,
  readCardRow,
  setCard,
  type MakeStudyHarness,
} from '#lib/server/study/store/study-suite-support.js';
import type { StudyHarness } from '#lib/server/study/test-support/harness.js';

const W0 = Date.parse('2026-01-01T04:00:00Z');
const WINDOW = { dayNumber: 0, startMs: W0, endMs: W0 + DAY_MS };
const NOW = W0 + 10 * 3_600_000;

// One suite for every dialect. SQLite runs always. Postgres runs when a URL is set.
export function defineStudyStoreSuite(make: MakeStudyHarness): void {
  let h: StudyHarness | undefined;
  afterEach(async () => {
    await h?.close();
    h = undefined;
  });
  async function open(): Promise<StudyHarness> {
    h = await make();
    h.clock.now = NOW;
    await addDeckRow(h, 'd1');
    return h;
  }

  describe('readStudySnapshots', () => {
    // Each card is the only card of note <name>, id <name>-c0.
    async function fixture(s: StudyHarness): Promise<void> {
      const set = async (name: string, patch: Parameters<typeof setCard>[2]) => {
        await addNote(s, name, ['d1']);
        await setCard(s, `${name}-c0`, patch);
      };
      await set('new', { due: 1 });
      await set('learnEarly', { state: 'learning', schedState: 'learning', due: NOW - 1 });
      await set('learnNow', { state: 'relearning', schedState: 'relearning', due: NOW });
      await set('learnLater', { state: 'learning', schedState: 'learning', due: NOW + 1000 });
      await set('learnTomorrow', {
        state: 'learning',
        schedState: 'learning',
        due: WINDOW.endMs + 5,
      });
      await set('reviewBefore', { state: 'review', schedState: 'review', due: WINDOW.endMs - 1 });
      await set('reviewAtEnd', { state: 'review', schedState: 'review', due: WINDOW.endMs });
      await set('suspended', { state: 'suspended', schedState: 'review', due: 0 });
      await set('buried', { state: 'buried', schedState: 'new', buriedUntil: NOW + 5 });
      await addNote(s, 'trashed', ['d1'], { deletedAt: 9 });
      await set('homeless', { deckId: null });
    }

    it('counts and picks heads from hand-made cards', async () => {
      const s = await open();
      await fixture(s);
      const input = { deckIds: ['d1'], nowMs: NOW, window: WINDOW, shuffleDeckIds: [] };
      expect(await s.studyStore.readStudySnapshots(input)).toEqual([
        {
          deckId: 'd1',
          newDone: 0,
          reviewDone: 0,
          learningDueCount: 2,
          learningTodayCount: 3,
          learningHead: expect.objectContaining({ cardId: 'learnEarly-c0', due: NOW - 1 }),
          nextLearningDue: NOW + 1000,
          reviewDueCount: 1,
          reviewHead: expect.objectContaining({ cardId: 'reviewBefore-c0' }),
          newCount: 1,
          newHead: expect.objectContaining({ cardId: 'new-c0' }),
        },
      ]);
    });

    it('counts done cards from the log in [start, end) by the current deck', async () => {
      const s = await open();
      await addDeckRow(s, 'd2');
      await addNote(s, 'a', ['d1']);
      await insertLog(s, 'l1', 'a-c0', WINDOW.startMs, 'new');
      await insertLog(s, 'l2', 'a-c0', WINDOW.endMs - 1, 'review');
      await insertLog(s, 'l3', 'a-c0', WINDOW.endMs, 'new');
      await insertLog(s, 'l4', 'a-c0', WINDOW.startMs - 1, 'review');
      await insertLog(s, 'l5', 'a-c0', NOW, 'learning');
      const input = { deckIds: ['d1', 'd2'], nowMs: NOW, window: WINDOW, shuffleDeckIds: [] };
      const [d1, d2] = await s.studyStore.readStudySnapshots(input);
      expect([d1?.newDone, d1?.reviewDone, d2?.newDone, d2?.reviewDone]).toEqual([1, 1, 0, 0]);
      // Documented behavior: the counts follow the card's current deck.
      expect(await s.store.moveCards(['a-c0'], 'd2')).toBe('ok');
      const [m1, m2] = await s.studyStore.readStudySnapshots(input);
      expect([m1?.newDone, m1?.reviewDone, m2?.newDone, m2?.reviewDone]).toEqual([0, 0, 1, 1]);
    });

    it('orders a random deck by the same shuffle key as the JS code', async () => {
      const s = await open();
      for (let i = 0; i < 50; i += 1) {
        await addNote(s, `r${i}`, ['d1']);
      }
      const positions: { id: string; position: number }[] = [];
      for (let i = 0; i < 50; i += 1) {
        const row = await readCardRow(s, `r${i}-c0`);
        positions.push({ id: `r${i}-c0`, position: row?.position ?? -1 });
      }
      const expected = positions.reduce((a, b) =>
        shuffleKey(b.position) < shuffleKey(a.position) ? b : a,
      );
      const input = { deckIds: ['d1'], nowMs: NOW, window: WINDOW, shuffleDeckIds: ['d1'] };
      const [random] = await s.studyStore.readStudySnapshots(input);
      expect(random?.newHead?.cardId).toBe(expected.id);
      const [added] = await s.studyStore.readStudySnapshots({ ...input, shuffleDeckIds: [] });
      expect(added?.newHead?.cardId).toBe('r0-c0');
    });
  });

  describe('answerCard', () => {
    it('writes the card and the log in one transaction', async () => {
      const s = await open();
      await addNote(s, 'a', ['d1']);
      const result = await answerVia(s, 'a-c0');
      expect(result).toMatchObject({ ok: true });
      expect(await readCardRow(s, 'a-c0')).toMatchObject({
        state: 'learning',
        schedState: 'learning',
        reps: 1,
        learningStep: 1,
        lastReview: NOW,
        due: NOW + 600_000,
      });
      expect(await countRows(s, 'review_log')).toBe(1);
    });

    it('writes nothing on a compute failure', async () => {
      const s = await open();
      await addNote(s, 'a', ['d1']);
      const before = await readCardRow(s, 'a-c0');
      expect(await answerVia(s, 'a-c0', { fail: fail(409, 'x') })).toEqual(fail(409, 'x'));
      expect(await readCardRow(s, 'a-c0')).toEqual(before);
      expect(await countRows(s, 'review_log')).toBe(0);
    });

    it('gives not_found for a missing card, a trashed note and a card without a deck', async () => {
      const s = await open();
      await addNote(s, 'a', ['d1']);
      await addNote(s, 'b', ['d1']);
      expect(await answerVia(s, 'nope')).toBe('not_found');
      await s.store.trashNote('a', NOW);
      expect(await answerVia(s, 'a-c0')).toBe('not_found');
      await setCard(s, 'b-c0', { deckId: null });
      expect(await answerVia(s, 'b-c0')).toBe('not_found');
      expect(await countRows(s, 'review_log')).toBe(0);
    });

    it('buries siblings only while they are new or review', async () => {
      const s = await open();
      await addNote(s, 'a', ['d1', 'd1', 'd1', 'd1']);
      await setCard(s, 'a-c2', { state: 'learning', schedState: 'learning' });
      await setCard(s, 'a-c3', { state: 'review', schedState: 'review' });
      const buryIds = ['a-c1', 'a-c2', 'a-c3'];
      expect(await answerVia(s, 'a-c0', { buryIds })).toMatchObject({ ok: true });
      const states = [];
      for (const id of buryIds) {
        states.push((await readCardRow(s, id))?.state);
      }
      expect(states).toEqual(['buried', 'learning', 'buried']);
      expect((await readCardRow(s, 'a-c1'))?.buriedUntil).toBe(NOW + DAY_MS / 2);
    });

    it('keeps reviewed_at strictly increasing when the clock does not move', async () => {
      const s = await open();
      await addNote(s, 'a', ['d1']);
      await addNote(s, 'b', ['d1']);
      const first = await answerVia(s, 'a-c0');
      const second = await answerVia(s, 'b-c0');
      if (first === 'not_found' || second === 'not_found' || !first.ok || !second.ok) {
        throw new Error('answer failed');
      }
      expect(second.plan.log.reviewedAt).toBe(first.plan.log.reviewedAt + 1);
      expect(second.plan.cardUpdate.lastReview).toBe(NOW + 1);
    });

    it('refuses a second answer with the same expected reps', async () => {
      const s = await open();
      await addNote(s, 'a', ['d1']);
      expect(await answerVia(s, 'a-c0', { expectedReps: 0 })).toMatchObject({ ok: true });
      expect(await answerVia(s, 'a-c0', { expectedReps: 0 })).toEqual(fail(409, 'stale_card'));
      expect(await countRows(s, 'review_log')).toBe(1);
    });
  });

  defineStudyStateSuite(open);
  defineStudyRaceSuite(open);
}
