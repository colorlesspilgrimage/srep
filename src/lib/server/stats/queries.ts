import type { DbHandle } from '#lib/server/db/client.js';
import type { CardDueRow, ReviewStatRow } from '#lib/server/stats/types.js';
import * as pg from '#lib/server/stats/queries.pg.js';
import * as sqlite from '#lib/server/stats/queries.sqlite.js';

export async function listReviewStats(handle: DbHandle): Promise<ReviewStatRow[]> {
  return handle.dialect === 'sqlite'
    ? sqlite.listReviewStats(handle.db)
    : pg.listReviewStats(handle.db);
}

export async function listReviewStatsSince(
  handle: DbHandle,
  sinceMs: number,
): Promise<ReviewStatRow[]> {
  return handle.dialect === 'sqlite'
    ? sqlite.listReviewStatsSince(handle.db, sinceMs)
    : pg.listReviewStatsSince(handle.db, sinceMs);
}

export async function listCardDueRows(handle: DbHandle): Promise<CardDueRow[]> {
  return handle.dialect === 'sqlite'
    ? sqlite.listCardDueRows(handle.db)
    : pg.listCardDueRows(handle.db);
}

export async function countReviewsForPreset(handle: DbHandle, presetId: string): Promise<number> {
  return handle.dialect === 'sqlite'
    ? sqlite.countReviewsForPreset(handle.db, presetId)
    : pg.countReviewsForPreset(handle.db, presetId);
}

export async function listPresetReviews(
  handle: DbHandle,
  presetId: string,
): Promise<ReviewStatRow[]> {
  return handle.dialect === 'sqlite'
    ? sqlite.listPresetReviews(handle.db, presetId)
    : pg.listPresetReviews(handle.db, presetId);
}
