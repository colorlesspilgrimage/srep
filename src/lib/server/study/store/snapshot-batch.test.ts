import { sql } from 'drizzle-orm';
import { PgDialect, type PgTransactionConfig } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { afterEach, describe, expect, it } from 'vitest';
import { addNote } from '#lib/server/domain/store/suite-support.js';
import { shuffleKey } from '#lib/server/study/core/queue-choice.js';
import { PG_READ_SNAPSHOT } from '#lib/server/study/store/read-snapshot.pg.js';
import { readPgSnapshotBatch, type PgBatchTx } from '#lib/server/study/store/snapshot-batch.pg.js';
import { readPgSnapshots } from '#lib/server/study/store/snapshot.pg.js';
import {
  addDeckRow,
  DAY_MS,
  insertLog,
  readCardRow,
  setCard,
} from '#lib/server/study/store/study-suite-support.js';
import { createStudyHarness, type StudyHarness } from '#lib/server/study/test-support/harness.js';

const W0 = Date.parse('2026-01-01T04:00:00Z');
const WINDOW = { dayNumber: 0, startMs: W0, endMs: W0 + DAY_MS };
const NOW = W0 + 10 * 3_600_000;

let h: StudyHarness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

async function open(): Promise<StudyHarness> {
  h = await createStudyHarness();
  return h;
}

describe('sqlite snapshot batch', () => {
  it('matches added and random heads for two decks', async () => {
    const s = await open();
    await addDeckRow(s, 'added');
    await addDeckRow(s, 'random');
    for (const deckId of ['added', 'random']) {
      for (let index = 0; index < 4; index += 1) {
        await addNote(s, `${deckId}-${index}`, [deckId]);
      }
    }
    const input = {
      deckIds: ['added', 'random'],
      nowMs: NOW,
      window: WINDOW,
      shuffleDeckIds: ['random'],
    };
    const [added, random] = await s.studyStore.readStudySnapshots(input);
    expect(added?.newHead?.cardId).toBe('added-0-c0');
    const positions = [];
    for (let index = 0; index < 4; index += 1) {
      const row = await readCardRow(s, `random-${index}-c0`);
      positions.push({ id: `random-${index}-c0`, position: row?.position ?? -1 });
    }
    const expected = positions.reduce((left, right) =>
      shuffleKey(right.position) < shuffleKey(left.position) ? right : left,
    );
    expect(random?.newHead?.cardId).toBe(expected.id);
  });

  it('omits a deleted note from counts and heads', async () => {
    const s = await open();
    await addDeckRow(s, 'd1');
    await addNote(s, 'gone', ['d1'], { deletedAt: 9 });
    const [row] = await s.studyStore.readStudySnapshots({
      deckIds: ['d1'],
      nowMs: NOW,
      window: WINDOW,
      shuffleDeckIds: [],
    });
    expect(row).toMatchObject({
      newCount: 0,
      reviewDueCount: 0,
      learningDueCount: 0,
      learningTodayCount: 0,
      newHead: null,
      reviewHead: null,
      learningHead: null,
    });
  });

  it('returns zeros and null heads for an empty deck', async () => {
    const s = await open();
    await addDeckRow(s, 'empty');
    const [row] = await s.studyStore.readStudySnapshots({
      deckIds: ['empty'],
      nowMs: NOW,
      window: WINDOW,
      shuffleDeckIds: [],
    });
    expect(row).toEqual({
      deckId: 'empty',
      newDone: 0,
      reviewDone: 0,
      learningDueCount: 0,
      learningTodayCount: 0,
      nextLearningDue: null,
      learningHead: null,
      reviewDueCount: 0,
      reviewHead: null,
      newCount: 0,
      newHead: null,
    });
  });

  it('includes startMs and excludes endMs', async () => {
    const s = await open();
    await addDeckRow(s, 'd1');
    await addNote(s, 'a', ['d1']);
    await insertLog(s, 'at-start', 'a-c0', WINDOW.startMs, 'new');
    await insertLog(s, 'before-end', 'a-c0', WINDOW.endMs - 1, 'review');
    await insertLog(s, 'at-end', 'a-c0', WINDOW.endMs, 'new');
    const [row] = await s.studyStore.readStudySnapshots({
      deckIds: ['d1'],
      nowMs: NOW,
      window: WINDOW,
      shuffleDeckIds: [],
    });
    expect(row?.newDone).toBe(1);
    expect(row?.reviewDone).toBe(1);
  });

  it('counts learning and relearning and skips a future review', async () => {
    const s = await open();
    await addDeckRow(s, 'd1');
    await addNote(s, 'learn', ['d1']);
    await addNote(s, 'relearn', ['d1']);
    await addNote(s, 'later', ['d1']);
    await setCard(s, 'learn-c0', { state: 'learning', schedState: 'learning', due: NOW });
    await setCard(s, 'relearn-c0', { state: 'relearning', schedState: 'relearning', due: NOW - 1 });
    await setCard(s, 'later-c0', { state: 'review', schedState: 'review', due: WINDOW.endMs });
    const [row] = await s.studyStore.readStudySnapshots({
      deckIds: ['d1'],
      nowMs: NOW,
      window: WINDOW,
      shuffleDeckIds: [],
    });
    expect(row?.learningDueCount).toBe(2);
    expect(row?.learningHead?.cardId).toBe('relearn-c0');
    expect(row?.reviewDueCount).toBe(0);
    expect(row?.reviewHead).toBeNull();
  });

  it('uses card_state_buried_idx for the unbury update', async () => {
    const s = await open();
    if (s.handle.dialect !== 'sqlite') {
      throw new Error('expected sqlite');
    }
    const rows = s.handle.db.all<{ detail: string }>(
      sql`explain query plan update card set state = sched_state, buried_until = null
        where state = 'buried' and buried_until <= ${NOW}`,
    );
    const detail = rows.map((row) => row.detail).join('\n');
    expect(detail).toContain('card_state_buried_idx');
    expect(detail.includes('SCAN card')).toBe(false);
  });
});

describe('postgres snapshot batch', () => {
  it('reads seven statements inside the repeatable-read transaction', async () => {
    const texts: string[] = [];
    const configs: (PgTransactionConfig | undefined)[] = [];
    const tx: PgBatchTx = {
      async execute(query) {
        texts.push(new PgDialect().sqlToQuery(query).sql);
        return rowsFor(texts[texts.length - 1] ?? '');
      },
    };
    const db = {
      async transaction(run: (inner: PgBatchTx) => Promise<unknown>, config?: PgTransactionConfig) {
        configs.push(config);
        return run(tx);
      },
    };
    const input = {
      deckIds: ['d1'],
      nowMs: NOW,
      window: WINDOW,
      shuffleDeckIds: ['d1'],
    };
    const [row] = await readPgSnapshots(db as unknown as PostgresJsDatabase, input);
    expect(configs).toEqual([PG_READ_SNAPSHOT]);
    expect(texts).toHaveLength(7);
    expect(texts.some((text) => text.includes('2654435761'))).toBe(true);
    expect(texts.some((text) => text.includes('deleted_at'))).toBe(true);
    expect(row).toMatchObject({
      deckId: 'd1',
      newDone: 2,
      reviewDone: 0,
      learningDueCount: 1,
      learningTodayCount: 2,
      nextLearningDue: 9,
      learningHead: { cardId: 'learn', due: 4, position: 1 },
      reviewDueCount: 3,
      reviewHead: { cardId: 'rev', due: 5, position: 2 },
      newCount: 4,
      newHead: { cardId: 'fresh', due: 6, position: 3 },
    });
    expect(await readPgSnapshotBatch(tx, { ...input, deckIds: [] })).toEqual([]);
  });
});

function rowsFor(text: string) {
  if (text.includes('review_log')) {
    return [{ deck_id: 'd1', state_before: 'new', n: '2' }];
  }
  if (text.includes('due_now')) {
    return [{ deck_id: 'd1', due_now: '1', today: '2', next_due: '9' }];
  }
  if (text.includes('row_number') || text.includes('limit 1')) {
    if (text.includes("'learning'")) {
      return [{ deck_id: 'd1', card_id: 'learn', due: '4', position: '1' }];
    }
    if (text.includes("'review'")) {
      return [{ deck_id: 'd1', card_id: 'rev', due: '5', position: '2' }];
    }
    return [{ deck_id: 'd1', card_id: 'fresh', due: '6', position: '3' }];
  }
  if (text.includes("'review'")) {
    return [{ deck_id: 'd1', n: '3' }];
  }
  return [{ deck_id: 'd1', n: '4' }];
}
