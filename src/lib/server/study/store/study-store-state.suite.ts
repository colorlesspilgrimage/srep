import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fail } from '#lib/server/auth/deps.js';
import { BUILTIN_PRESET } from '#lib/server/domain/builtin.js';
import { addNote, countRows } from '#lib/server/domain/store/suite-support.js';
import type { CardRow } from '#lib/server/domain/store/store-types.js';
import { planUndo, schedFieldsOf } from '#lib/server/study/core/answer-plan.js';
import { planSuspend } from '#lib/server/study/core/card-state-plan.js';
import { compareSched, replayCard } from '#lib/server/study/core/replay.js';
import { answerVia, readCardRow, setCard } from '#lib/server/study/store/study-suite-support.js';
import type { ReplayBatchItem } from '#lib/server/study/store/study-store-types.js';
import type { StudyHarness } from '#lib/server/study/test-support/harness.js';
import { queryRows } from '#lib/server/study/test-support/simulation-checks.js';

async function noteCards(h: StudyHarness, noteId: string): Promise<CardRow[]> {
  return (await h.store.getNoteState(noteId))?.cards ?? [];
}

// The second half of the study store suite. `open` gives a harness with deck 'd1'.
export function defineStudyStateSuite(open: () => Promise<StudyHarness>): void {
  describe('undoLastReview', () => {
    it('restores the exact card and sibling rows and deletes only the latest log', async () => {
      const h = await open();
      await addNote(h, 'a', ['d1', 'd1', 'd1']);
      await addNote(h, 'b', ['d1']);
      expect(await answerVia(h, 'b-c0')).toMatchObject({ ok: true });
      const before = await noteCards(h, 'a');
      h.clock.now += 5000;
      expect(await answerVia(h, 'a-c0', { burySiblings: true })).toMatchObject({ ok: true });
      expect((await noteCards(h, 'a')).map((c) => c.state)).toEqual([
        'learning',
        'buried',
        'buried',
      ]);
      const undone = await h.studyStore.undoLastReview(planUndo);
      expect(undone).toMatchObject({ ok: true, log: { cardId: 'a-c0' } });
      expect(await noteCards(h, 'a')).toEqual(before);
      expect(await countRows(h, 'review_log')).toBe(1);
      expect(await h.studyStore.undoLastReview(planUndo)).toMatchObject({
        log: { cardId: 'b-c0' },
      });
      expect((await readCardRow(h, 'b-c0'))?.reps).toBe(0);
      expect(await h.studyStore.undoLastReview(planUndo)).toBe('nothing_to_undo');
    });
  });

  describe('changeCardStates', () => {
    it('writes nothing for an unknown id or a compute failure', async () => {
      const h = await open();
      await addNote(h, 'a', ['d1', 'd1']);
      const ids = ['a-c0', 'a-c1'];
      expect(await h.studyStore.changeCardStates([...ids, 'nope'], planSuspend)).toBe(
        'card_not_found',
      );
      expect(await h.studyStore.changeCardStates(ids, () => fail(409, 'x'))).toEqual(
        fail(409, 'x'),
      );
      expect((await noteCards(h, 'a')).map((c) => c.state)).toEqual(['new', 'new']);
      expect(await h.studyStore.changeCardStates([...ids, ...ids], planSuspend)).toEqual({
        ok: true,
      });
      expect((await noteCards(h, 'a')).map((c) => c.state)).toEqual(['suspended', 'suspended']);
    });
  });

  describe('unburyExpired', () => {
    it('unburies cards whose time is over to their scheduling state, once', async () => {
      const h = await open();
      const now = h.clock.now;
      await addNote(h, 'a', ['d1', 'd1', 'd1']);
      await setCard(h, 'a-c0', { state: 'buried', schedState: 'review', buriedUntil: now });
      await setCard(h, 'a-c1', { state: 'buried', schedState: 'new', buriedUntil: now + 1 });
      await setCard(h, 'a-c2', { state: 'buried', schedState: 'learning', buriedUntil: now - 9 });
      expect(await h.studyStore.unburyExpired(now)).toBe(2);
      expect(await h.studyStore.unburyExpired(now)).toBe(0);
      const cards = await noteCards(h, 'a');
      expect(cards.map((c) => [c.state, c.buriedUntil])).toEqual([
        ['review', null],
        ['buried', now + 1],
        ['learning', null],
      ]);
    });
  });

  describe('replay batches and rebuild', () => {
    it('pages every card once with its logs in time order', async () => {
      const h = await open();
      await addNote(h, 'a', ['d1', 'd1', 'd1']);
      await addNote(h, 'b', ['d1', 'd1']);
      for (const id of ['a-c1', 'b-c0', 'a-c1']) {
        expect(await answerVia(h, id)).toMatchObject({ ok: true });
        h.clock.now += 700_000;
      }
      for (const limit of [1, 2, 500]) {
        const seen: ReplayBatchItem[] = [];
        let after: string | null = null;
        for (;;) {
          const batch = await h.studyStore.readReplayBatch(after, limit);
          seen.push(...batch);
          if (batch.length < limit) break;
          after = (batch.at(-1) as ReplayBatchItem).card.id;
        }
        expect(seen.map((s) => s.card.id)).toEqual(['a-c0', 'a-c1', 'a-c2', 'b-c0', 'b-c1']);
        const times = seen.find((s) => s.card.id === 'a-c1')?.logs.map((l) => l.reviewedAt);
        expect(times).toHaveLength(2);
        expect((times?.[0] ?? 0) < (times?.[1] ?? 0)).toBe(true);
      }
    });

    it('rebuilds a tampered card and leaves a correct card alone', async () => {
      const h = await open();
      await addNote(h, 'a', ['d1', 'd1']);
      await answerVia(h, 'a-c0');
      await answerVia(h, 'a-c1');
      const good = await readCardRow(h, 'a-c1');
      const fixed = await readCardRow(h, 'a-c0');
      await setCard(h, 'a-c0', { stability: 42, state: 'review' });
      const result = await h.studyStore.rebuildCards((batch) =>
        batch.flatMap((item) => {
          const replay = replayCard(item.logs, BUILTIN_PRESET);
          const differs =
            replay !== null &&
            (compareSched(schedFieldsOf(item.card), replay.fields).length > 0 ||
              item.card.state !== replay.fields.schedState);
          return differs && replay !== null ? [{ id: item.card.id, fields: replay.fields }] : [];
        }),
      );
      expect(result).toEqual({ checked: 2, changed: 1 });
      expect(await readCardRow(h, 'a-c0')).toEqual(fixed);
      expect(await readCardRow(h, 'a-c1')).toEqual(good);
    });
  });

  describe('study settings', () => {
    it('keeps one row and round-trips the value', async () => {
      const h = await open();
      expect(await h.studyStore.getStudySettings()).toBeUndefined();
      await h.studyStore.putStudySettings({ rolloverHour: 4, timezone: 'UTC' });
      await h.studyStore.putStudySettings({ rolloverHour: 6, timezone: 'Europe/Berlin' });
      expect(await h.studyStore.getStudySettings()).toEqual({
        rolloverHour: 6,
        timezone: 'Europe/Berlin',
      });
      const rows = await queryRows<{ n: number }>(
        h.handle,
        sql`select count(*) as n from app_settings where key = 'study'`,
      );
      expect(Number(rows[0]?.n)).toBe(1);
    });
  });

  describe('concurrent study writes', () => {
    it('applies only one of two parallel answers to one card', async () => {
      const h = await open();
      await addNote(h, 'a', ['d1']);
      const results = await Promise.all([
        answerVia(h, 'a-c0', { expectedReps: 0 }),
        answerVia(h, 'a-c0', { expectedReps: 0 }),
      ]);
      const ok = results.filter((r) => r !== 'not_found' && r.ok);
      expect(ok).toHaveLength(1);
      expect(results).toContainEqual(fail(409, 'stale_card'));
      expect(await countRows(h, 'review_log')).toBe(1);
    });

    it('never keeps a log row without its card change, with answer and undo in parallel', async () => {
      const h = await open();
      await addNote(h, 'a', ['d1']);
      await Promise.all([answerVia(h, 'a-c0'), h.studyStore.undoLastReview(planUndo)]);
      const reps = (await readCardRow(h, 'a-c0'))?.reps;
      const logs = await countRows(h, 'review_log');
      expect([reps, logs]).toSatisfy(
        ([r, l]: [number, number]) => (r === 1 && l === 1) || (r === 0 && l === 0),
      );
    });
  });
}
