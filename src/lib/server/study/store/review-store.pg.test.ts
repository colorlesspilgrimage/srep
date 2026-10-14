import { PgDialect } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { describe, expect, it } from 'vitest';
import { fail } from '#lib/server/auth/deps.js';
import type { CardRow } from '#lib/server/domain/store/store-types.js';
import type { AnswerPlan, UndoPlan } from '#lib/server/study/core/answer-plan.js';
import type { ReviewLogRow } from '#lib/server/study/core/types.js';
import { createPgStudyReviewStore } from '#lib/server/study/store/review-store.pg.js';

// Contract: stub coverage for the Postgres answer read, answer, and undo.
// No database server is used.

const dialect = new PgDialect();

type Stub = {
  db: PostgresJsDatabase;
  pushSelect: (rows: unknown[]) => void;
  pushContext: (row: Record<string, unknown> | undefined) => void;
  writes: () => number;
};

function chain(rows: unknown[]): Record<string, unknown> {
  const result = Promise.resolve(rows);
  const node: Record<string, unknown> = {};
  const self = () => node;
  for (const name of ['from', 'where', 'orderBy', 'limit', 'leftJoin', 'set', 'values']) {
    node[name] = self;
  }
  node.for = () => result;
  node.then = (ok?: (value: unknown) => unknown, err?: (error: unknown) => unknown) =>
    result.then(ok, err);
  return node;
}

function createStub(): Stub {
  const selects: unknown[][] = [];
  const contexts: (Record<string, unknown> | undefined)[] = [];
  let writes = 0;
  const stub: Stub = {
    db: {} as PostgresJsDatabase,
    pushSelect(rows) {
      selects.push(rows);
    },
    pushContext(row) {
      contexts.push(row);
    },
    writes: () => writes,
  };
  const db = {
    select: () => chain(selects.shift() ?? []),
    insert: () => {
      writes += 1;
      return chain([]);
    },
    update: () => {
      writes += 1;
      return chain([]);
    },
    delete: () => {
      writes += 1;
      return chain([]);
    },
    async execute(query: unknown) {
      const text = dialect.sqlToQuery(query as never).sql;
      if (text.includes('pg_advisory_xact_lock')) {
        return [];
      }
      const row = contexts.shift();
      return row === undefined ? [] : [row];
    },
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  stub.db = db as unknown as PostgresJsDatabase;
  return stub;
}

function cardJson(id: string, deckId: unknown = 'deck-1'): Record<string, unknown> {
  return {
    id,
    note_id: 'note-1',
    template_id: 'tpl-1',
    ordinal: '1',
    deck_id: deckId,
    state: 'review',
    due: '10',
    stability: '2',
    difficulty: '3',
    last_review: id === 'no-review' ? null : '9',
    reps: '4',
    lapses: '0',
    position: '8',
    buried_until: undefined,
    flags: '0',
    sched_state: 'review',
    learning_step: '1',
  };
}

function presetJson(arrays: boolean, bury: boolean): Record<string, unknown> {
  return {
    id: 'preset-1',
    name: 'Default',
    new_per_day: '20',
    reviews_per_day: '200',
    desired_retention: '0.9',
    learning_steps: arrays ? ['1', '10'] : '1',
    relearning_steps: arrays ? ['10'] : null,
    max_interval: '36500',
    fsrs_params: arrays ? ['1'] : null,
    bury_siblings: bury,
    new_order: 'added',
  };
}

function cardRow(id: string): CardRow {
  return {
    id,
    noteId: 'note-1',
    templateId: 'tpl-1',
    ordinal: 1,
    deckId: 'deck-1',
    state: 'review',
    due: 10,
    stability: 2,
    difficulty: 3,
    lastReview: 9,
    reps: 4,
    lapses: 0,
    position: 8,
    buriedUntil: null,
    flags: 0,
    schedState: 'review',
    learningStep: 1,
  };
}

function logRow(buried: string[]): ReviewLogRow {
  return {
    id: 'log-1',
    cardId: 'card-1',
    reviewedAt: 10,
    rating: 3,
    stateBefore: 'review',
    dueBefore: 1,
    stabilityBefore: 1,
    difficultyBefore: 1,
    lastReviewBefore: null,
    repsBefore: 1,
    lapsesBefore: 0,
    stepBefore: 0,
    elapsedMs: 1000,
    intervalAfter: 10,
    buriedSiblingIds: buried,
  };
}

function answerPlan(buryIds: string[]): AnswerPlan {
  return {
    ok: true,
    cardUpdate: { ...cardRow('card-1'), state: 'review' },
    log: logRow(buryIds),
    buryIds,
    buryUntil: 99,
  };
}

function undoPlan(unburyIds: string[]): UndoPlan {
  return { cardRestore: { ...cardRow('card-1'), state: 'review' }, unburyIds };
}

describe('postgres review store stub', () => {
  it('reads a card and answers from one statement', async () => {
    const stub = createStub();
    const store = createPgStudyReviewStore(stub.db);
    stub.pushSelect([]);
    expect(await store.readCard('missing')).toBeUndefined();
    stub.pushSelect([{ card: cardRow('card-1'), deckPreset: null }]);
    expect(await store.readCard('card-1')).toEqual({ card: cardRow('card-1'), deckPreset: null });

    expect(await store.answerCard('gone', () => answerPlan([]))).toBe('not_found');
    stub.pushContext({ card: 'bad', preset: presetJson(true, true), siblings: [], max_at: null });
    expect(await store.answerCard('bad', () => answerPlan([]))).toBe('not_found');
    const badDue = cardJson('card-1');
    badDue.due = 'nope';
    stub.pushContext({
      card: badDue,
      preset: presetJson(true, true),
      siblings: [],
      max_at: null,
    });
    expect(await store.answerCard('nan-due', () => answerPlan([]))).toBe('not_found');
    const badState = cardJson('card-1');
    badState.state = 'pwned';
    stub.pushContext({
      card: badState,
      preset: presetJson(true, true),
      siblings: [],
      max_at: null,
    });
    expect(await store.answerCard('bad-state', () => answerPlan([]))).toBe('not_found');
    const huge = presetJson(true, true);
    huge.new_per_day = 'Infinity';
    stub.pushContext({
      card: cardJson('card-1'),
      preset: huge,
      siblings: [],
      max_at: null,
    });
    expect(await store.answerCard('huge-quota', () => answerPlan([]))).toBe('not_found');
    stub.pushContext({
      card: cardJson('card-1', null),
      preset: presetJson(true, true),
      siblings: [],
      max_at: null,
    });
    expect(await store.answerCard('nodeck', () => answerPlan([]))).toBe('not_found');
    stub.pushContext({
      card: cardJson('card-1'),
      preset: null,
      siblings: null,
      max_at: undefined,
    });
    expect(await store.answerCard('nopreset', () => answerPlan([]))).toBe('not_found');

    stub.pushContext({
      card: cardJson('card-1'),
      preset: presetJson(false, false),
      siblings: [cardJson('sib-1'), { id: 4 }, null, 'nope', ['x']],
      max_at: '15',
    });
    const denied = await store.answerCard('card-1', (ctx) => {
      expect(ctx.card.ordinal).toBe(1);
      expect(ctx.card.lastReview).toBe(9);
      expect(ctx.deckPreset.learningSteps).toEqual([]);
      expect(ctx.deckPreset.fsrsParams).toBeNull();
      expect(ctx.siblings.map((row) => row.id)).toEqual(['sib-1']);
      expect(ctx.lastReviewedAtMax).toBe(15);
      return fail(409, 'stale_card');
    });
    expect(denied).toEqual({ ok: false, status: 409, error: 'stale_card' });
    expect(stub.writes()).toBe(0);

    stub.pushContext({
      card: cardJson('no-review'),
      preset: presetJson(true, true),
      siblings: [],
      max_at: null,
    });
    const saved = await store.answerCard('no-review', (ctx) => {
      expect(ctx.card.lastReview).toBeNull();
      expect(ctx.card.buriedUntil).toBeNull();
      expect(ctx.deckPreset.learningSteps).toEqual([1, 10]);
      expect(ctx.deckPreset.burySiblings).toBe(true);
      expect(ctx.lastReviewedAtMax).toBeNull();
      return answerPlan(['sib-1']);
    });
    expect(saved).toMatchObject({ ok: true });
    expect(stub.writes()).toBe(3);
  });

  it('undoes a log, skips a missing log, and rejects a log without a card', async () => {
    const stub = createStub();
    const store = createPgStudyReviewStore(stub.db);
    expect(await store.undoLastReview(() => undoPlan([]))).toBe('nothing_to_undo');

    stub.pushSelect([logRow(['sib-1'])]);
    stub.pushSelect([]);
    await expect(store.undoLastReview(() => undoPlan(['sib-1']))).rejects.toThrow(
      'review log row without a card',
    );

    const before = stub.writes();
    stub.pushSelect([logRow([])]);
    stub.pushSelect([cardRow('card-1')]);
    const undone = await store.undoLastReview((ctx) => {
      expect(ctx.card.id).toBe('card-1');
      expect(ctx.buried).toEqual([]);
      return undoPlan(['sib-1']);
    });
    expect(undone).toMatchObject({ ok: true, log: { id: 'log-1' } });
    expect(stub.writes()).toBe(before + 3);
  });
});
