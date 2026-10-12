// Contract: Postgres queries for the per-deck study snapshot. Read-only.
// All values are drizzle parameters. The only raw SQL pieces are the constant shuffle numbers.
// Postgres can return aggregates as strings, so every count goes through Number().
import { and, asc, eq, gte, inArray, isNull, lt, lte, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { card, note, reviewLog } from '#lib/server/db/schema/pg.js';
import {
  SHUFFLE_MODULUS,
  SHUFFLE_MULTIPLIER,
  type DeckSnapshot,
  type HeadCard,
} from '#lib/server/study/core/queue-choice.js';
import { PG_READ_SNAPSHOT } from '#lib/server/study/store/read-snapshot.pg.js';
import type { StudySnapshotInput } from '#lib/server/study/store/study-store-types.js';

type Exec = Pick<PostgresJsDatabase, 'select'>;

// The same expression as shuffleKey() in queue-choice.ts. Constants only, no user text.
const PG_SHUFFLE_KEY = sql`(cast(${card.position} as bigint) * ${sql.raw(
  String(SHUFFLE_MULTIPLIER),
)}) % ${sql.raw(String(SHUFFLE_MODULUS))}`;

const LEARNING_STATES = ['learning', 'relearning'] as const;

async function headOf(
  tx: Exec,
  deckId: string,
  where: SQL | undefined,
  order: SQL[],
): Promise<HeadCard | null> {
  const [row] = await tx
    .select({ cardId: card.id, due: card.due, position: card.position })
    .from(card)
    .innerJoin(note, eq(note.id, card.noteId))
    .where(and(eq(card.deckId, deckId), isNull(note.deletedAt), where))
    .orderBy(...order)
    .limit(1);
  return row ?? null;
}

async function countOf(tx: Exec, deckId: string, where: SQL | undefined): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)` })
    .from(card)
    .innerJoin(note, eq(note.id, card.noteId))
    .where(and(eq(card.deckId, deckId), isNull(note.deletedAt), where));
  return Number(row?.n ?? 0);
}

// Counts the review log rows of the study day by the card's current deck.
async function doneCounts(tx: Exec, deckId: string, input: StudySnapshotInput) {
  const rows = await tx
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
    .groupBy(reviewLog.stateBefore);
  const count = (state: string) => Number(rows.find((r) => r.stateBefore === state)?.n ?? 0);
  return { newDone: count('new'), reviewDone: count('review') };
}

async function learningStats(tx: Exec, deckId: string, input: StudySnapshotInput) {
  const { nowMs } = input;
  const { endMs } = input.window;
  const [row] = await tx
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
    );
  return {
    learningDueCount: Number(row?.dueNow ?? 0),
    learningTodayCount: Number(row?.today ?? 0),
    nextLearningDue: row?.next === null || row?.next === undefined ? null : Number(row.next),
  };
}

async function deckSnapshot(
  tx: Exec,
  deckId: string,
  input: StudySnapshotInput,
): Promise<DeckSnapshot> {
  const learning = and(inArray(card.state, LEARNING_STATES), lte(card.due, input.nowMs));
  const review = and(eq(card.state, 'review'), lt(card.due, input.window.endMs));
  const fresh = eq(card.state, 'new');
  const newOrder = input.shuffleDeckIds.includes(deckId)
    ? [asc(PG_SHUFFLE_KEY), asc(card.position), asc(card.id)]
    : [asc(card.position), asc(card.id)];
  const reviewOrder = [asc(card.due), asc(card.position), asc(card.id)];
  return {
    deckId,
    ...(await doneCounts(tx, deckId, input)),
    ...(await learningStats(tx, deckId, input)),
    learningHead: await headOf(tx, deckId, learning, [asc(card.due), asc(card.id)]),
    reviewDueCount: await countOf(tx, deckId, review),
    reviewHead: await headOf(tx, deckId, review, reviewOrder),
    newCount: await countOf(tx, deckId, fresh),
    newHead: await headOf(tx, deckId, fresh, newOrder),
  };
}

// One repeatable-read, read-only transaction gives one consistent view of all decks.
export async function readPgSnapshots(
  db: PostgresJsDatabase,
  input: StudySnapshotInput,
): Promise<DeckSnapshot[]> {
  return db.transaction(async (tx) => {
    const out: DeckSnapshot[] = [];
    for (const deckId of input.deckIds) {
      out.push(await deckSnapshot(tx, deckId, input));
    }
    return out;
  }, PG_READ_SNAPSHOT);
}
