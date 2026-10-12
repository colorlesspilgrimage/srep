// Checks for the study simulation. They read the database with plain SQL, not through the
// study store, so a store bug cannot hide itself. No vitest import: the script uses this file.
import { sql, type SQL } from 'drizzle-orm';
import type { DbHandle } from '#lib/server/db/client.js';
import type { DeckRow, PresetRow } from '#lib/server/domain/store/store-types.js';
import type { StudyWindow } from '#lib/server/study/core/types.js';

export async function queryRows<T>(handle: DbHandle, query: SQL): Promise<T[]> {
  if (handle.dialect === 'sqlite') {
    return handle.db.all<T>(query);
  }
  return [...(await handle.db.execute<Record<string, unknown>>(query))] as T[];
}

/** All card rows and all log rows, ordered by id. Used for the exact undo check. */
export async function fullSnapshot(handle: DbHandle): Promise<string> {
  const cards = await queryRows(handle, sql`select * from card order by id`);
  const logs = await queryRows(handle, sql`select * from review_log order by id`);
  return JSON.stringify({ cards, logs });
}

/** Counts the decks whose new or review count in the window passes the preset limit. */
export async function countLimitBreaks(
  handle: DbHandle,
  window: StudyWindow,
  decks: DeckRow[],
  presets: PresetRow[],
): Promise<number> {
  const rows = await queryRows<{ deck_id: string; state_before: string; n: number }>(
    handle,
    sql`select c.deck_id as deck_id, r.state_before as state_before, count(*) as n
      from review_log r join card c on c.id = r.card_id
      where r.reviewed_at >= ${window.startMs} and r.reviewed_at < ${window.endMs}
      group by c.deck_id, r.state_before`,
  );
  let breaks = 0;
  for (const row of rows) {
    const deck = decks.find((d) => d.id === row.deck_id);
    const preset = presets.find((p) => p.id === deck?.presetId);
    if (preset === undefined) {
      continue;
    }
    const n = Number(row.n);
    if (row.state_before === 'new' && n > preset.newPerDay) {
      breaks += 1;
    }
    if (row.state_before === 'review' && n > preset.reviewsPerDay) {
      breaks += 1;
    }
  }
  return breaks;
}

/** Cards with reps > 0 whose last_review is not the reviewed_at of their latest log row. */
export async function countLastReviewBreaks(handle: DbHandle): Promise<number> {
  const rows = await queryRows<{ n: number }>(
    handle,
    sql`select count(*) as n from card c
      where c.reps > 0 and (c.last_review is null or c.last_review <>
        (select max(r.reviewed_at) from review_log r where r.card_id = c.id))`,
  );
  return Number(rows[0]?.n ?? 0);
}

/** Log rows whose reviewed_at is not strictly greater than the row before (by time, then id). */
export async function countLogOrderBreaks(handle: DbHandle): Promise<number> {
  const rows = await queryRows<{ reviewed_at: number }>(
    handle,
    sql`select reviewed_at from review_log order by reviewed_at, id`,
  );
  let breaks = 0;
  for (let i = 1; i < rows.length; i += 1) {
    if (Number(rows[i]?.reviewed_at) <= Number(rows[i - 1]?.reviewed_at)) {
      breaks += 1;
    }
  }
  return breaks;
}

/** The state column of one card, read with plain SQL. */
export async function cardStateOf(handle: DbHandle, cardId: string): Promise<string | undefined> {
  const rows = await queryRows<{ state: string }>(
    handle,
    sql`select state from card where id = ${cardId}`,
  );
  return rows[0]?.state;
}

/** Mulberry32: a small seeded generator in [0, 1). The same seed gives the same sequence. */
export function seededUnitRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded bytes for newId: the ids are the same in every run with the same seed. */
export function seededBytes(seed: number): (size: number) => Buffer {
  const next = seededUnitRandom(seed);
  return (size) => {
    const out = Buffer.alloc(size);
    for (let i = 0; i < size; i += 1) {
      out[i] = Math.floor(next() * 256);
    }
    return out;
  };
}
