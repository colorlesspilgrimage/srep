// Contract: build DeckSnapshot rows from batched SQL results.
// Input: deck ids in caller order, plus one row set per query.
// Output: one snapshot per deck id. Missing groups are zero or null.
// Counts from Postgres may be strings. This module converts them with Number.
import type { DeckSnapshot, HeadCard } from '#lib/server/study/core/queue-choice.js';

export type SqlRow = Record<string, unknown>;

export type BatchParts = {
  done: SqlRow[];
  learning: SqlRow[];
  learningHeads: SqlRow[];
  reviewCounts: SqlRow[];
  reviewHeads: SqlRow[];
  newCounts: SqlRow[];
  newHeads: SqlRow[];
};

function num(value: unknown): number {
  return Number(value ?? 0);
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value);
}

function text(row: SqlRow, key: string): string {
  return String(row[key] ?? '');
}

type DonePair = { newDone: number; reviewDone: number };

function doneMap(rows: SqlRow[]): Map<string, DonePair> {
  const map = new Map<string, DonePair>();
  for (const row of rows) {
    const deckId = text(row, 'deck_id');
    const pair = map.get(deckId) ?? { newDone: 0, reviewDone: 0 };
    const count = num(row.n);
    if (row.state_before === 'new') {
      pair.newDone = count;
    }
    if (row.state_before === 'review') {
      pair.reviewDone = count;
    }
    map.set(deckId, pair);
  }
  return map;
}

function countMap(rows: SqlRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(text(row, 'deck_id'), num(row.n));
  }
  return map;
}

function headMap(rows: SqlRow[]): Map<string, HeadCard> {
  const map = new Map<string, HeadCard>();
  for (const row of rows) {
    map.set(text(row, 'deck_id'), {
      cardId: text(row, 'card_id'),
      due: num(row.due),
      position: num(row.position),
    });
  }
  return map;
}

type LearnRow = { dueNow: number; today: number; next: number | null };

function learnMap(rows: SqlRow[]): Map<string, LearnRow> {
  const map = new Map<string, LearnRow>();
  for (const row of rows) {
    map.set(text(row, 'deck_id'), {
      dueNow: num(row.due_now),
      today: num(row.today),
      next: numOrNull(row.next_due),
    });
  }
  return map;
}

export function assembleSnapshots(deckIds: string[], parts: BatchParts): DeckSnapshot[] {
  const done = doneMap(parts.done);
  const learn = learnMap(parts.learning);
  const reviewCounts = countMap(parts.reviewCounts);
  const newCounts = countMap(parts.newCounts);
  const learningHeads = headMap(parts.learningHeads);
  const reviewHeads = headMap(parts.reviewHeads);
  const newHeads = headMap(parts.newHeads);
  return deckIds.map((deckId) => {
    const learned = learn.get(deckId);
    const finished = done.get(deckId);
    return {
      deckId,
      newDone: finished?.newDone ?? 0,
      reviewDone: finished?.reviewDone ?? 0,
      learningDueCount: learned?.dueNow ?? 0,
      learningTodayCount: learned?.today ?? 0,
      nextLearningDue: learned?.next ?? null,
      learningHead: learningHeads.get(deckId) ?? null,
      reviewDueCount: reviewCounts.get(deckId) ?? 0,
      reviewHead: reviewHeads.get(deckId) ?? null,
      newCount: newCounts.get(deckId) ?? 0,
      newHead: newHeads.get(deckId) ?? null,
    };
  });
}
