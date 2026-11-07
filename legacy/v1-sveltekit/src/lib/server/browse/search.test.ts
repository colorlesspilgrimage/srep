import type { DbHandle } from '#lib/server/db/client.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pgSearch = vi.hoisted(() => ({
  searchCards: vi.fn(async () => ({ rows: [], nextCursor: null as string | null })),
}));

vi.mock('#lib/server/browse/browse.pg.js', () => pgSearch);
vi.mock('#lib/server/db/index.js', async () => {
  const { browseHandle } = await import('#lib/server/browse/test-handle.js');
  return { getDb: () => browseHandle() };
});
vi.mock('#lib/server/study/context.js', async () => {
  const { studyRouteState } = await import('#lib/server/study/test-support/route-support.js');
  return { getStudyContext: () => studyRouteState.deps };
});

import { setBrowseHandle } from '#lib/server/browse/test-handle.js';
import { readCursor, readLimit, searchBrowse } from '#lib/server/browse/search.js';
import type { StudyDeps } from '#lib/server/study/deps.js';
import { studyRouteState } from '#lib/server/study/test-support/route-support.js';

const ID = '123e4567-e89b-42d3-a456-426614174000';

afterEach(() => {
  setBrowseHandle(undefined);
  studyRouteState.deps = undefined;
  pgSearch.searchCards.mockClear();
});

describe('readLimit and readCursor', () => {
  it('accepts the limit bounds and a uuid cursor', () => {
    expect(readLimit(null)).toBe(50);
    expect(readLimit('1')).toBe(1);
    expect(readLimit('100')).toBe(100);
    for (const raw of ['0', '101', '01', '1e1', ' 10', '10 ', '+10', '']) {
      expect(readLimit(raw), raw).toBeNull();
    }
    expect(readCursor(null)).toBeNull();
    expect(readCursor('')).toBeNull();
    expect(readCursor(ID.toUpperCase())).toBe(ID);
    expect(readCursor('../etc/passwd')).toBe('bad');
    expect(readCursor(`'; drop table note; --`)).toBe('bad');
  });
});

describe('searchBrowse postgres path', () => {
  it('calls the postgres search and skips it when settings are bad', async () => {
    studyRouteState.deps = {
      store: { getStudySettings: async () => undefined },
      now: () => Date.parse('2026-01-01T09:00:00Z'),
      domain: {},
      random: () => Buffer.alloc(16),
      logger: { error() {} },
    } as unknown as StudyDeps;
    setBrowseHandle({ dialect: 'postgres', db: {} } as DbHandle);
    const ok = await searchBrowse({ q: 'tag:animals', limit: null, cursor: null });
    expect(ok).toEqual({ ok: true, rows: [], nextCursor: null });
    expect(pgSearch.searchCards).toHaveBeenCalledOnce();
    const bad = await searchBrowse({ q: 'prop:lapses!', limit: '2', cursor: null });
    expect(bad).toEqual({ ok: false, status: 400, error: 'bad_query' });
    studyRouteState.deps = {
      store: { getStudySettings: async () => 'x' },
      now: () => 0,
      domain: {},
      random: () => Buffer.alloc(16),
      logger: { error() {} },
    } as unknown as StudyDeps;
    pgSearch.searchCards.mockClear();
    const corrupt = await searchBrowse({ q: 'gato', limit: null, cursor: null });
    expect(corrupt).toEqual({ ok: false, status: 500, error: 'settings_corrupt' });
    expect(pgSearch.searchCards).not.toHaveBeenCalled();
  });
});
