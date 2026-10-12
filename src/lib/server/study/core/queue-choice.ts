// Contract: pure queue logic. Inputs are per-deck snapshots (counts and head cards that the
// store read) and per-deck quotas from each deck's own preset. Output: the next card, a
// wait time, or done. No I/O and no clock: the caller passes nowMs.
// A parent deck never caps a child deck. Each deck uses only its own quota.
import type { NewOrder } from '#lib/server/db/schema/sqlite.js';

export type DeckQuota = {
  deckId: string;
  newPerDay: number;
  reviewsPerDay: number;
  newOrder: NewOrder;
};

export type HeadCard = { cardId: string; due: number; position: number };

export type DeckSnapshot = {
  deckId: string;
  /** Review log rows of today with state_before 'new'. */
  newDone: number;
  /** Review log rows of today with state_before 'review'. */
  reviewDone: number;
  /** Learning and relearning cards with due <= now. */
  learningDueCount: number;
  /** Learning and relearning cards with due < end of the study day. */
  learningTodayCount: number;
  /** The learning or relearning card with the earliest due <= now. */
  learningHead: HeadCard | null;
  /** The earliest learning due with now < due < end of the study day. */
  nextLearningDue: number | null;
  /** Review cards with due < end of the study day. */
  reviewDueCount: number;
  reviewHead: HeadCard | null;
  newCount: number;
  newHead: HeadCard | null;
};

export type QueueChoice =
  | { kind: 'card'; cardId: string; source: 'learning' | 'review' | 'new' }
  | { kind: 'wait'; until: number }
  | { kind: 'done' };

export type StudyCounts = { new: number; learning: number; review: number };

// A stable pseudo-random order for newOrder 'random' (Knuth multiplicative hash).
// The stores use the same expression in SQL: (position * SHUFFLE_MULTIPLIER) % SHUFFLE_MODULUS.
// A plain JS product loses precision above position 3_393_554 (2^53 / multiplier).
// Math.imul keeps the exact low 32 bits, so the JS key equals the SQL key for every
// non-negative integer position below 2^32.
export const SHUFFLE_MULTIPLIER = 2654435761;
export const SHUFFLE_MODULUS = 4294967296;

export function shuffleKey(position: number): number {
  return Math.imul(position, SHUFFLE_MULTIPLIER) >>> 0;
}

export function remainingQuota(
  snapshot: DeckSnapshot,
  quota: DeckQuota | undefined,
): { newLeft: number; reviewLeft: number } {
  const newPerDay = quota?.newPerDay ?? 0;
  const reviewsPerDay = quota?.reviewsPerDay ?? 0;
  return {
    newLeft: Math.min(snapshot.newCount, Math.max(0, newPerDay - snapshot.newDone)),
    reviewLeft: Math.min(snapshot.reviewDueCount, Math.max(0, reviewsPerDay - snapshot.reviewDone)),
  };
}

export function studyCounts(snapshots: DeckSnapshot[], quotas: DeckQuota[]): StudyCounts {
  const byDeck = new Map(quotas.map((q) => [q.deckId, q]));
  const counts: StudyCounts = { new: 0, learning: 0, review: 0 };
  for (const snapshot of snapshots) {
    const left = remainingQuota(snapshot, byDeck.get(snapshot.deckId));
    counts.new += left.newLeft;
    counts.review += left.reviewLeft;
    counts.learning += snapshot.learningTodayCount;
  }
  return counts;
}

// Compares tuples of numbers, then the card id.
function lessThan(a: { keys: number[]; cardId: string }, b: { keys: number[]; cardId: string }) {
  for (let i = 0; i < a.keys.length; i += 1) {
    const diff = (a.keys[i] as number) - (b.keys[i] as number);
    if (diff !== 0) {
      return diff < 0;
    }
  }
  return a.cardId < b.cardId;
}

function pickMin(candidates: { keys: number[]; cardId: string }[]): string | null {
  let best: { keys: number[]; cardId: string } | null = null;
  for (const candidate of candidates) {
    if (best === null || lessThan(candidate, best)) {
      best = candidate;
    }
  }
  return best?.cardId ?? null;
}

type DeckState = { snapshot: DeckSnapshot; quota: DeckQuota | undefined } & {
  newLeft: number;
  reviewLeft: number;
};

function pickReview(decks: DeckState[]): string | null {
  return pickMin(
    decks.flatMap(({ snapshot, reviewLeft }) =>
      reviewLeft > 0 && snapshot.reviewHead !== null
        ? [
            {
              keys: [snapshot.reviewHead.due, snapshot.reviewHead.position],
              cardId: snapshot.reviewHead.cardId,
            },
          ]
        : [],
    ),
  );
}

function pickNew(decks: DeckState[]): string | null {
  return pickMin(
    decks.flatMap(({ snapshot, quota, newLeft }) => {
      const head = snapshot.newHead;
      if (newLeft <= 0 || head === null) {
        return [];
      }
      const orderKey = quota?.newOrder === 'random' ? shuffleKey(head.position) : head.position;
      return [{ keys: [orderKey, head.position], cardId: head.cardId }];
    }),
  );
}

function pickLearning(snapshots: DeckSnapshot[]): string | null {
  return pickMin(
    snapshots.flatMap((s) =>
      s.learningHead === null
        ? []
        : [{ keys: [s.learningHead.due], cardId: s.learningHead.cardId }],
    ),
  );
}

// Order: due learning cards first. Then new and review cards interleave in proportion:
// take new when newDone / (newDone + newLeft) <= revDone / (revDone + reviewsLeft).
// The rule is stateless, so it gives the same order after a restart.
export function chooseNext(
  snapshots: DeckSnapshot[],
  quotas: DeckQuota[],
  nowMs: number,
): QueueChoice {
  const learning = pickLearning(snapshots);
  if (learning !== null) {
    return { kind: 'card', cardId: learning, source: 'learning' };
  }
  const byDeck = new Map(quotas.map((q) => [q.deckId, q]));
  const decks: DeckState[] = snapshots.map((snapshot) => {
    const quota = byDeck.get(snapshot.deckId);
    return { snapshot, quota, ...remainingQuota(snapshot, quota) };
  });
  const sum = (pick: (d: DeckState) => number) => decks.reduce((n, d) => n + pick(d), 0);
  const newLeft = sum((d) => d.newLeft);
  const reviewsLeft = sum((d) => d.reviewLeft);
  if (newLeft === 0 && reviewsLeft === 0) {
    const waits = snapshots.flatMap((s) =>
      s.nextLearningDue !== null && s.nextLearningDue > nowMs ? [s.nextLearningDue] : [],
    );
    return waits.length > 0 ? { kind: 'wait', until: Math.min(...waits) } : { kind: 'done' };
  }
  const newDone = sum((d) => d.snapshot.newDone);
  const revDone = sum((d) => d.snapshot.reviewDone);
  const takeNew =
    reviewsLeft === 0 ||
    (newLeft > 0 && newDone * (revDone + reviewsLeft) <= revDone * (newDone + newLeft));
  const cardId = takeNew ? pickNew(decks) : pickReview(decks);
  if (cardId === null) {
    return { kind: 'done' };
  }
  return { kind: 'card', cardId, source: takeNew ? 'new' : 'review' };
}
