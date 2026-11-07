import { eq, gte } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { card, deck, reviewLog } from '#lib/server/db/schema/sqlite.js';
import type { CardDueRow, ReviewStatRow } from '#lib/server/stats/types.js';

export function listReviewStats(db: BetterSQLite3Database): ReviewStatRow[] {
  return db
    .select({
      reviewedAt: reviewLog.reviewedAt,
      rating: reviewLog.rating,
      stateBefore: reviewLog.stateBefore,
      elapsedMs: reviewLog.elapsedMs,
      cardId: reviewLog.cardId,
      deckId: card.deckId,
      presetId: deck.presetId,
    })
    .from(reviewLog)
    .innerJoin(card, eq(card.id, reviewLog.cardId))
    .leftJoin(deck, eq(deck.id, card.deckId))
    .all();
}

export function listReviewStatsSince(db: BetterSQLite3Database, sinceMs: number): ReviewStatRow[] {
  return db
    .select({
      reviewedAt: reviewLog.reviewedAt,
      rating: reviewLog.rating,
      stateBefore: reviewLog.stateBefore,
      elapsedMs: reviewLog.elapsedMs,
      cardId: reviewLog.cardId,
      deckId: card.deckId,
      presetId: deck.presetId,
    })
    .from(reviewLog)
    .innerJoin(card, eq(card.id, reviewLog.cardId))
    .leftJoin(deck, eq(deck.id, card.deckId))
    .where(gte(reviewLog.reviewedAt, sinceMs))
    .all();
}

export function listCardDueRows(db: BetterSQLite3Database): CardDueRow[] {
  return db
    .select({
      due: card.due,
      schedState: card.schedState,
      state: card.state,
      stability: card.stability,
      lastReview: card.lastReview,
    })
    .from(card)
    .all();
}

export function countReviewsForPreset(db: BetterSQLite3Database, presetId: string): number {
  const rows = db
    .select({ id: reviewLog.id })
    .from(reviewLog)
    .innerJoin(card, eq(card.id, reviewLog.cardId))
    .innerJoin(deck, eq(deck.id, card.deckId))
    .where(eq(deck.presetId, presetId))
    .all();
  return rows.length;
}

export function listPresetReviews(db: BetterSQLite3Database, presetId: string): ReviewStatRow[] {
  return db
    .select({
      reviewedAt: reviewLog.reviewedAt,
      rating: reviewLog.rating,
      stateBefore: reviewLog.stateBefore,
      elapsedMs: reviewLog.elapsedMs,
      cardId: reviewLog.cardId,
      deckId: card.deckId,
      presetId: deck.presetId,
    })
    .from(reviewLog)
    .innerJoin(card, eq(card.id, reviewLog.cardId))
    .innerJoin(deck, eq(deck.id, card.deckId))
    .where(eq(deck.presetId, presetId))
    .all();
}
