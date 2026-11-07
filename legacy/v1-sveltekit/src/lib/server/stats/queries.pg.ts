import { eq, gte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { card, deck, reviewLog } from '#lib/server/db/schema/pg.js';
import type { CardDueRow, ReviewStatRow } from '#lib/server/stats/types.js';

export async function listReviewStats(db: PostgresJsDatabase): Promise<ReviewStatRow[]> {
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
    .leftJoin(deck, eq(deck.id, card.deckId));
}

export async function listReviewStatsSince(
  db: PostgresJsDatabase,
  sinceMs: number,
): Promise<ReviewStatRow[]> {
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
    .where(gte(reviewLog.reviewedAt, sinceMs));
}

export async function listCardDueRows(db: PostgresJsDatabase): Promise<CardDueRow[]> {
  return db
    .select({
      due: card.due,
      schedState: card.schedState,
      state: card.state,
      stability: card.stability,
      lastReview: card.lastReview,
    })
    .from(card);
}

export async function countReviewsForPreset(
  db: PostgresJsDatabase,
  presetId: string,
): Promise<number> {
  const rows = await db
    .select({ id: reviewLog.id })
    .from(reviewLog)
    .innerJoin(card, eq(card.id, reviewLog.cardId))
    .innerJoin(deck, eq(deck.id, card.deckId))
    .where(eq(deck.presetId, presetId));
  return rows.length;
}

export async function listPresetReviews(
  db: PostgresJsDatabase,
  presetId: string,
): Promise<ReviewStatRow[]> {
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
    .where(eq(deck.presetId, presetId));
}
