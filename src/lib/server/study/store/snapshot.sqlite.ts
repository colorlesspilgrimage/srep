// Contract: SQLite queries for the per-deck study snapshot. Read-only.
// All values are drizzle parameters. The only raw SQL pieces are the constant shuffle numbers.
import { and, asc, eq, gte, inArray, isNull, lt, lte, sql, type SQL } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { card, note, reviewLog } from '#lib/server/db/schema/sqlite.js';
import {
  SHUFFLE_MODULUS,
  SHUFFLE_MULTIPLIER,
  type DeckSnapshot,
  type HeadCard,
} from '#lib/server/study/core/queue-choice.js';
import type { StudySnapshotInput } from '#lib/server/study/store/study-store-types.js';

type Exec = Pick<BetterSQLite3Database, 'select'>;

// The same expression as shuffleKey() in queue-choice.ts. Constants only, no user text.
const SQLITE_SHUFFLE_KEY = sql`(cast(${card.position} as integer) * ${sql.raw(
  String(SHUFFLE_MULTIPLIER),
)}) % ${sql.raw(String(SHUFFLE_MODULUS))}`;

const LEARNING_STATES = ['learning', 'relearning'] as const;

function headOf(tx: Exec, deckId: string, where: SQL | undefined, order: SQL[]): HeadCard | null {
  const row = tx
    .select({ cardId: card.id, due: card.due, position: card.position })
    .from(card)
    .innerJoin(note, eq(note.id, card.noteId))
    .where(and(eq(card.deckId, deckId), isNull(note.deletedAt), where))
    .orderBy(...order)
    .limit(1)
    .get();
  return row ?? null;
}

function countOf(tx: Exec, deckId: string, where: SQL | undefined): number {
  const row = tx
    .select({ n: sql<number>`count(*)` })
    .from(card)
    .innerJoin(note, eq(note.id, card.noteId))
    .where(and(eq(card.deckId, deckId), isNull(note.deletedAt), where))
    .get();
  return Number(row?.n ?? 0);
}

// Counts the review log rows of the study day by the card's current deck.
function doneCounts(tx: Exec, deckId: string, input: StudySnapshotInput) {
  const rows = tx
    .select({ stateBefore: reviewLog.stateBefore, n: sql<number>`count(*)` })
    .from(reviewLog)
    .innerJoin(card, eq(card.id, reviewLog.cardId))
    .where(
      and(
        eq(card.deckId, deckId),
        gte(reviewLog.reviewedAt, input.window.startMs),
        lt(reviewLog.reviewedAt, input.window.endMs),
        inArray(reviewLog.stateBefore, ['new', 'review']),
      ),
    )
    .groupBy(reviewLog.stateBefore)
    .all();
  const count = (state: string) => Number(rows.find((r) => r.stateBefore === state)?.n ?? 0);
  return { newDone: count('new'), reviewDone: count('review') };
}

function learningStats(tx: Exec, deckId: string, input: StudySnapshotInput) {
  const { nowMs } = input;
  const { endMs } = input.window;
  const row = tx
    .select({
      dueNow: sql<number>`coalesce(sum(case when ${card.due} <= ${nowMs} then 1 else 0 end), 0)`,
      today: sql<number>`coalesce(sum(case when ${card.due} < ${endMs} then 1 else 0 end), 0)`,
      next: sql<
        number | null
      >`min(case when ${card.due} > ${nowMs} and ${card.due} < ${endMs} then ${card.due} end)`,
    })
    .from(card)
    .innerJoin(note, eq(note.id, card.noteId))
    .where(
      and(eq(card.deckId, deckId), isNull(note.deletedAt), inArray(card.state, LEARNING_STATES)),
    )
    .get();
  return {
    learningDueCount: Number(row?.dueNow ?? 0),
    learningTodayCount: Number(row?.today ?? 0),
    nextLearningDue: row?.next === null || row?.next === undefined ? null : Number(row.next),
  };
}

function deckSnapshot(tx: Exec, deckId: string, input: StudySnapshotInput): DeckSnapshot {
  const learning = and(inArray(card.state, LEARNING_STATES), lte(card.due, input.nowMs));
  const review = and(eq(card.state, 'review'), lt(card.due, input.window.endMs));
  const fresh = eq(card.state, 'new');
  const newOrder = input.shuffleDeckIds.includes(deckId)
    ? [asc(SQLITE_SHUFFLE_KEY), asc(card.position), asc(card.id)]
    : [asc(card.position), asc(card.id)];
  return {
    deckId,
    ...doneCounts(tx, deckId, input),
    ...learningStats(tx, deckId, input),
    learningHead: headOf(tx, deckId, learning, [asc(card.due), asc(card.id)]),
    reviewDueCount: countOf(tx, deckId, review),
    reviewHead: headOf(tx, deckId, review, [asc(card.due), asc(card.position), asc(card.id)]),
    newCount: countOf(tx, deckId, fresh),
    newHead: headOf(tx, deckId, fresh, newOrder),
  };
}

export function readSqliteSnapshots(
  db: BetterSQLite3Database,
  input: StudySnapshotInput,
): DeckSnapshot[] {
  return db.transaction((tx) => input.deckIds.map((deckId) => deckSnapshot(tx, deckId, input)));
}
