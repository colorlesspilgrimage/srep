import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  chooseNext,
  remainingQuota,
  shuffleKey,
  SHUFFLE_MODULUS,
  SHUFFLE_MULTIPLIER,
  studyCounts,
  type DeckQuota,
  type DeckSnapshot,
} from '#lib/server/study/core/queue-choice.js';

const NOW = 1_000_000;

function snap(deckId: string, patch: Partial<DeckSnapshot> = {}): DeckSnapshot {
  return {
    deckId,
    newDone: 0,
    reviewDone: 0,
    learningDueCount: 0,
    learningTodayCount: 0,
    learningHead: null,
    nextLearningDue: null,
    reviewDueCount: 0,
    reviewHead: null,
    newCount: 0,
    newHead: null,
    ...patch,
  };
}

function quota(deckId: string, patch: Partial<DeckQuota> = {}): DeckQuota {
  return { deckId, newPerDay: 20, reviewsPerDay: 200, newOrder: 'added', ...patch };
}

const head = (cardId: string, due: number, position = 0) => ({ cardId, due, position });

describe('chooseNext', () => {
  it('takes a due learning card first, the earliest due wins, due == now counts', () => {
    const snapshots = [
      snap('a', { learningHead: head('l2', NOW), newCount: 1, newHead: head('n', 0) }),
      snap('b', { learningHead: head('l1', NOW - 5), reviewDueCount: 1, reviewHead: head('r', 0) }),
    ];
    const quotas = [quota('a'), quota('b')];
    expect(chooseNext(snapshots, quotas, NOW)).toEqual({
      kind: 'card',
      cardId: 'l1',
      source: 'learning',
    });
    expect(chooseNext([snapshots[0] as DeckSnapshot], quotas, NOW)).toMatchObject({
      cardId: 'l2',
    });
  });

  it('breaks a tie of learning due by card id', () => {
    const snapshots = [
      snap('a', { learningHead: head('z', NOW) }),
      snap('b', { learningHead: head('m', NOW) }),
    ];
    expect(chooseNext(snapshots, [quota('a'), quota('b')], NOW)).toMatchObject({ cardId: 'm' });
  });

  it('interleaves 3 new and 6 reviews in proportion', () => {
    let s = snap('a', {
      newCount: 3,
      newHead: head('n', 0),
      reviewDueCount: 6,
      reviewHead: head('r', 0),
    });
    const sources: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const choice = chooseNext([s], [quota('a')], NOW);
      if (choice.kind !== 'card') {
        sources.push(choice.kind);
        break;
      }
      sources.push(choice.source);
      s =
        choice.source === 'new'
          ? { ...s, newDone: s.newDone + 1, newCount: s.newCount - 1 }
          : { ...s, reviewDone: s.reviewDone + 1, reviewDueCount: s.reviewDueCount - 1 };
      if (s.newCount === 0) s = { ...s, newHead: null };
      if (s.reviewDueCount === 0) s = { ...s, reviewHead: null };
    }
    expect(sources).toEqual([
      'new',
      'review',
      'review',
      'new',
      'review',
      'review',
      'new',
      'review',
      'review',
      'done',
    ]);
  });

  it('takes new when no review is left, and review when no new is left', () => {
    const newOnly = snap('a', { newCount: 2, newHead: head('n', 0), reviewDone: 3 });
    expect(chooseNext([newOnly], [quota('a')], NOW)).toMatchObject({ source: 'new' });
    const reviewOnly = snap('a', { reviewDueCount: 2, reviewHead: head('r', 0), newDone: 9 });
    expect(chooseNext([reviewOnly], [quota('a')], NOW)).toMatchObject({ source: 'review' });
  });

  it('gives done when the limits are 0 or used up, and when nothing remains', () => {
    const full = snap('a', {
      newCount: 5,
      newHead: head('n', 0),
      reviewDueCount: 5,
      reviewHead: head('r', 0),
    });
    const zero = quota('a', { newPerDay: 0, reviewsPerDay: 0 });
    expect(chooseNext([full], [zero], NOW)).toEqual({ kind: 'done' });
    const used = { ...full, newDone: 20, reviewDone: 200 };
    expect(chooseNext([used], [quota('a')], NOW)).toEqual({ kind: 'done' });
    expect(chooseNext([snap('a')], [quota('a')], NOW)).toEqual({ kind: 'done' });
    expect(chooseNext([], [], NOW)).toEqual({ kind: 'done' });
    expect(chooseNext([full], [], NOW)).toEqual({ kind: 'done' });
  });

  it('uses each deck quota alone: a full child does not block its parent', () => {
    const parent = snap('parent', { newCount: 3, newHead: head('p', 0, 9) });
    const child = snap('child', { newCount: 3, newHead: head('c', 0, 1), newDone: 2 });
    const quotas = [quota('parent', { newPerDay: 5 }), quota('child', { newPerDay: 2 })];
    expect(chooseNext([parent, child], quotas, NOW)).toMatchObject({ cardId: 'p' });
    const roomy = [quota('parent', { newPerDay: 5 }), quota('child', { newPerDay: 3 })];
    expect(chooseNext([parent, child], roomy, NOW)).toMatchObject({ cardId: 'c' });
  });

  it('waits for the earliest learning card later today', () => {
    const snapshots = [
      snap('a', { nextLearningDue: NOW + 600_000 }),
      snap('b', { nextLearningDue: NOW + 60_000 }),
    ];
    expect(chooseNext(snapshots, [quota('a'), quota('b')], NOW)).toEqual({
      kind: 'wait',
      until: NOW + 60_000,
    });
  });

  it('orders new cards by position, or by shuffle key for a random deck', () => {
    const a = snap('a', { newCount: 1, newHead: head('a1', 0, 3) });
    const b = snap('b', { newCount: 1, newHead: head('b1', 0, 1) });
    const added = [quota('a'), quota('b')];
    expect(chooseNext([a, b], added, NOW)).toMatchObject({ cardId: 'b1' });
    const random = [quota('a', { newOrder: 'random' }), quota('b', { newOrder: 'random' })];
    const expected = shuffleKey(3) < shuffleKey(1) ? 'a1' : 'b1';
    expect(chooseNext([a, b], random, NOW)).toMatchObject({ cardId: expected });
  });

  it('orders reviews by due, then position, then card id', () => {
    const a = snap('a', { reviewDueCount: 1, reviewHead: head('ra', 50, 2) });
    const b = snap('b', { reviewDueCount: 1, reviewHead: head('rb', 50, 1) });
    const c = snap('c', { reviewDueCount: 1, reviewHead: head('rc', 40, 9) });
    const quotas = [quota('a'), quota('b'), quota('c')];
    expect(chooseNext([a, b], quotas, NOW)).toMatchObject({ cardId: 'rb' });
    expect(chooseNext([a, b, c], quotas, NOW)).toMatchObject({ cardId: 'rc' });
    const tie = snap('d', { reviewDueCount: 1, reviewHead: head('ra0', 50, 2) });
    expect(chooseNext([a, tie], [...quotas, quota('d')], NOW)).toMatchObject({ cardId: 'ra' });
  });
});

describe('quota and counts', () => {
  it('caps the remaining counts by the limit and by the cards', () => {
    const s = snap('a', { newCount: 10, newDone: 3, reviewDueCount: 4, reviewDone: 1 });
    expect(remainingQuota(s, quota('a', { newPerDay: 5, reviewsPerDay: 100 }))).toEqual({
      newLeft: 2,
      reviewLeft: 4,
    });
    expect(remainingQuota({ ...s, newDone: 9 }, quota('a', { newPerDay: 5 }))).toMatchObject({
      newLeft: 0,
    });
    expect(remainingQuota(s, undefined)).toEqual({ newLeft: 0, reviewLeft: 0 });
  });

  it('sums the counts over decks', () => {
    const snapshots = [
      snap('a', { newCount: 10, reviewDueCount: 3, learningTodayCount: 2 }),
      snap('b', { newCount: 1, reviewDueCount: 30, learningTodayCount: 1 }),
    ];
    const quotas = [quota('a', { newPerDay: 4 }), quota('b', { reviewsPerDay: 10 })];
    expect(studyCounts(snapshots, quotas)).toEqual({ new: 5, learning: 3, review: 13 });
  });
});

describe('shuffleKey', () => {
  it('is exact for every position up to 2 000 000', () => {
    expect(shuffleKey(0)).toBe(0);
    expect(shuffleKey(1)).toBe(SHUFFLE_MULTIPLIER % SHUFFLE_MODULUS);
    expect(2_000_000 * SHUFFLE_MULTIPLIER).toBeLessThan(Number.MAX_SAFE_INTEGER);
    const big = shuffleKey(2_000_000);
    expect(big).toBeLessThan(SHUFFLE_MODULUS);
    expect(big).toBe(Number((2_000_000n * BigInt(SHUFFLE_MULTIPLIER)) % BigInt(SHUFFLE_MODULUS)));
  });

  // Regression: the plain JS product lost precision above 3 393 554, so the JS key and
  // the SQL key gave a different order for a large position.
  it('equals the exact 64-bit SQL expression above the float limit', () => {
    const exact = (p: number) =>
      Number((BigInt(p) * BigInt(SHUFFLE_MULTIPLIER)) % BigInt(SHUFFLE_MODULUS));
    for (const position of [3_393_554, 3_393_555, 10_000_001, 2 ** 31, 2 ** 32 - 1]) {
      expect(shuffleKey(position), String(position)).toBe(exact(position));
    }
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 32 - 1 }), (p) => shuffleKey(p) === exact(p)),
      { seed: 1012, numRuns: 2000 },
    );
  });
});
