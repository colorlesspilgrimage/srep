// Contract: insert the bench rows with bound parameters.
// Input: deck count, notes per deck, and the study window.
// Output: ids and row counts. Deck names are parameters, not SQL text.
// The default 20 by 500 shape has 8436 review_log rows.
import { sql, type SQL } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { BASIC_CARD_ID, BASIC_ID, DEFAULT_PRESET_ID } from '#lib/server/domain/builtin.js';
import type { DbHandle } from '#lib/server/db/client.js';
import type { StudyWindow } from '#lib/server/study/core/types.js';

export type NoteSplit = {
  fresh: number;
  dueReview: number;
  learning: number;
  future: number;
  buried: number;
};

type Kind = 'fresh' | 'dueReview' | 'learning' | 'future' | 'buried';

export type SeedCounts = {
  decks: number;
  notes: number;
  cards: number;
  reviewLogs: number;
};

export type SeedResult = SeedCounts & {
  deckIds: string[];
  noteIds: string[];
  newCardIds: string[];
};

export function splitNotes(count: number): NoteSplit {
  if (count === 500) {
    return { fresh: 200, dueReview: 200, learning: 50, future: 30, buried: 20 };
  }
  const fresh = Math.floor(count * 0.4);
  const dueReview = Math.floor(count * 0.4);
  const learning = Math.floor(count * 0.1);
  const future = Math.floor(count * 0.06);
  return {
    fresh,
    dueReview,
    learning,
    future,
    buried: count - fresh - dueReview - learning - future,
  };
}

export function needsStudyDayLog(
  decks: number,
  notesPerDeck: number,
  deckIndex: number,
  reviewIndex: number,
): boolean {
  if (decks === 20 && notesPerDeck === 500) {
    if (reviewIndex < 21) {
      return true;
    }
    return deckIndex === 0 && reviewIndex < 37;
  }
  return reviewIndex < 21;
}

function kindAt(index: number, split: NoteSplit): Kind {
  if (index < split.fresh) {
    return 'fresh';
  }
  if (index < split.fresh + split.dueReview) {
    return 'dueReview';
  }
  if (index < split.fresh + split.dueReview + split.learning) {
    return 'learning';
  }
  if (index < split.fresh + split.dueReview + split.learning + split.future) {
    return 'future';
  }
  return 'buried';
}

export function deckInsertSql(id: string, name: string, presetId: string): SQL {
  return sql`insert into deck (id, parent_id, name, path, preset_id, description, archived_at)
    values (${id}, ${null}, ${name}, ${name}, ${presetId}, ${''}, ${null})`;
}

function noteSql(id: string, nowMs: number): SQL {
  const fields = JSON.stringify(['front', 'back']);
  return sql`insert into note
    (id, note_type_id, guid, fields, created_at, updated_at, checksum, deleted_at)
    values (${id}, ${BASIC_ID}, ${`g-${id}`}, ${fields}, ${nowMs}, ${nowMs}, ${'bench'}, ${null})`;
}

function cardState(kind: Kind): 'new' | 'learning' | 'buried' | 'review' {
  if (kind === 'fresh') {
    return 'new';
  }
  if (kind === 'learning') {
    return 'learning';
  }
  if (kind === 'buried') {
    return 'buried';
  }
  return 'review';
}

function schedState(kind: Kind): 'new' | 'learning' | 'review' {
  if (kind === 'learning') {
    return 'learning';
  }
  if (kind === 'fresh') {
    return 'new';
  }
  return 'review';
}

function cardSql(
  id: string,
  noteId: string,
  deckId: string,
  kind: Kind,
  due: number,
  position: number,
  buriedUntil: number | null,
): SQL {
  const state = cardState(kind);
  const sched = schedState(kind);
  const reps = kind === 'dueReview' || kind === 'future' ? 1 : 0;
  return sql`insert into card (
      id, note_id, template_id, ordinal, deck_id, state, due, stability, difficulty,
      last_review, reps, lapses, position, buried_until, flags, sched_state, learning_step
    ) values (
      ${id}, ${noteId}, ${BASIC_CARD_ID}, ${0}, ${deckId}, ${state}, ${due}, ${reps}, ${0},
      ${null}, ${reps}, ${0}, ${position}, ${buriedUntil}, ${0}, ${sched}, ${0}
    )`;
}

function logSql(id: string, cardId: string, reviewedAt: number): SQL {
  return sql`insert into review_log (
      id, card_id, reviewed_at, rating, state_before, due_before, stability_before,
      difficulty_before, elapsed_ms, interval_after
    ) values (
      ${id}, ${cardId}, ${reviewedAt}, ${3}, ${'review'}, ${0}, ${0}, ${0}, ${1000}, ${10}
    )`;
}

type Built = { queries: SQL[]; result: SeedResult };

function dueFor(kind: Kind, nowMs: number, endMs: number): number {
  if (kind === 'future') {
    return endMs;
  }
  if (kind === 'learning' || kind === 'dueReview') {
    return nowMs - 1000;
  }
  return nowMs;
}

function appendNote(
  queries: SQL[],
  deckIndex: number,
  noteIndex: number,
  deckId: string,
  decks: number,
  notesPerDeck: number,
  nowMs: number,
  window: StudyWindow,
  position: number,
  reviewIndex: number,
): { noteId: string; newCardId: string | null; reviewLogs: number; reviewIndex: number } {
  const split = splitNotes(notesPerDeck);
  const kind = kindAt(noteIndex, split);
  const noteId = `n${deckIndex}-${noteIndex}`;
  const cardId = `c${deckIndex}-${noteIndex}`;
  const buriedUntil = kind === 'buried' ? nowMs - 1 : null;
  queries.push(noteSql(noteId, nowMs));
  queries.push(
    cardSql(cardId, noteId, deckId, kind, dueFor(kind, nowMs, window.endMs), position, buriedUntil),
  );
  if (kind !== 'dueReview') {
    return { noteId, newCardId: kind === 'fresh' ? cardId : null, reviewLogs: 0, reviewIndex };
  }
  queries.push(logSql(`h${deckIndex}-${noteIndex}-0`, cardId, window.startMs - 2));
  queries.push(logSql(`h${deckIndex}-${noteIndex}-1`, cardId, window.startMs - 1));
  let reviewLogs = 2;
  if (needsStudyDayLog(decks, notesPerDeck, deckIndex, reviewIndex)) {
    queries.push(logSql(`s${deckIndex}-${noteIndex}`, cardId, window.startMs));
    reviewLogs += 1;
  }
  return { noteId, newCardId: null, reviewLogs, reviewIndex: reviewIndex + 1 };
}

function appendDeck(
  result: SeedResult,
  queries: SQL[],
  deckIndex: number,
  decks: number,
  notesPerDeck: number,
  nowMs: number,
  window: StudyWindow,
  position: number,
): number {
  const deckId = `d${deckIndex}`;
  result.deckIds.push(deckId);
  queries.push(deckInsertSql(deckId, `Deck${deckIndex + 1}`, DEFAULT_PRESET_ID));
  let reviewIndex = 0;
  let next = position;
  for (let noteIndex = 0; noteIndex < notesPerDeck; noteIndex += 1) {
    const piece = appendNote(
      queries,
      deckIndex,
      noteIndex,
      deckId,
      decks,
      notesPerDeck,
      nowMs,
      window,
      next,
      reviewIndex,
    );
    next += 1;
    result.noteIds.push(piece.noteId);
    result.reviewLogs += piece.reviewLogs;
    reviewIndex = piece.reviewIndex;
    if (piece.newCardId !== null) {
      result.newCardIds.push(piece.newCardId);
    }
  }
  return next;
}

export function buildSeed(
  decks: number,
  notesPerDeck: number,
  nowMs: number,
  window: StudyWindow,
): Built {
  const queries: SQL[] = [];
  const result: SeedResult = {
    deckIds: [],
    noteIds: [],
    newCardIds: [],
    decks,
    notes: decks * notesPerDeck,
    cards: decks * notesPerDeck,
    reviewLogs: 0,
  };
  let position = 0;
  for (let deckIndex = 0; deckIndex < decks; deckIndex += 1) {
    position = appendDeck(result, queries, deckIndex, decks, notesPerDeck, nowMs, window, position);
  }
  return { queries, result };
}

function insertSqlite(db: BetterSQLite3Database, queries: SQL[]): void {
  db.transaction((tx) => {
    for (const query of queries) {
      tx.run(query);
    }
  });
}

async function insertPg(db: PostgresJsDatabase, queries: SQL[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const query of queries) {
      await tx.execute(query);
    }
  });
}

export async function seedBench(
  handle: DbHandle,
  decks: number,
  notesPerDeck: number,
  nowMs: number,
  window: StudyWindow,
): Promise<SeedResult> {
  const built = buildSeed(decks, notesPerDeck, nowMs, window);
  if (handle.dialect === 'sqlite') {
    insertSqlite(handle.db, built.queries);
  } else {
    await insertPg(handle.db, built.queries);
  }
  return built.result;
}
