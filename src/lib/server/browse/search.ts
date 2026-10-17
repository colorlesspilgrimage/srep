// Contract: searchBrowse loads the study window and runs the dialect search.
// q, limit, and cursor are untrusted. A bad value is 400 bad_query.
// Default limit is 50. limit is an integer from 1 to 100.
// A cursor must be a UUID. A failed match does not build a path (CWE-20).
// The query string is parsed as data. It is not SQL text (CWE-89).

import { z } from 'zod';
import { fail, type Result } from '#lib/server/auth/deps.js';
import { searchCards as searchCardsPg } from '#lib/server/browse/browse.pg.js';
import { searchCards as searchCardsSqlite } from '#lib/server/browse/browse.sqlite.js';
import { parseBrowseQuery } from '#lib/server/browse/parse-query.js';
import type { BrowsePage, BrowseQuery } from '#lib/server/browse/types.js';
import type { DbHandle } from '#lib/server/db/client.js';
import { getDb } from '#lib/server/db/index.js';
import { studyWindow } from '#lib/server/study/core/day-clock.js';
import { getStudyContext } from '#lib/server/study/context.js';
import { getSettings } from '#lib/server/study/study-settings.js';

const LIMIT = /^(?:[1-9]|[1-9][0-9]|100)$/;

export function readLimit(raw: string | null): number | null {
  if (raw === null) return 50;
  if (!LIMIT.test(raw)) return null;
  return Number(raw);
}

export function readCursor(raw: string | null): string | null | 'bad' {
  if (raw === null || raw === '') return null;
  const parsed = z.uuid().safeParse(raw);
  if (!parsed.success) return 'bad';
  return parsed.data.toLowerCase();
}

async function runSearch(
  handle: DbHandle,
  query: BrowseQuery,
  windowEndMs: number,
  limit: number,
  cursor: string | null,
): Promise<BrowsePage> {
  if (handle.dialect === 'sqlite') {
    return searchCardsSqlite(handle.db, query, windowEndMs, limit, cursor);
  }
  return searchCardsPg(handle.db, query, windowEndMs, limit, cursor);
}

export async function searchBrowse(input: {
  q: string | null;
  limit: string | null;
  cursor: string | null;
}): Promise<Result<BrowsePage>> {
  const parsed = parseBrowseQuery(input.q ?? '');
  if (!parsed.ok) return fail(400, 'bad_query');
  const limit = readLimit(input.limit);
  const cursor = readCursor(input.cursor);
  if (limit === null || cursor === 'bad') return fail(400, 'bad_query');
  const deps = getStudyContext();
  const settings = await getSettings(deps);
  if (!settings.ok) return settings;
  const windowEndMs = studyWindow(deps.now(), settings.settings).endMs;
  const page = await runSearch(getDb(), parsed.query, windowEndMs, limit, cursor);
  return { ok: true, rows: page.rows, nextCursor: page.nextCursor };
}
