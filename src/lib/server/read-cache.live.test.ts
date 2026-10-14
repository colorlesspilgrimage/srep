import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { readCached } from '#lib/server/read-cache.js';

// Contract: a commit from another connection drops the Postgres read cache.
// This process's own statements do not drop it.

const CANDIDATES = [
  process.env.SREP_TEST_POSTGRES_URL,
  'postgres://srep:srep@127.0.0.1:5432/srep_cache',
  'postgres://srep:srep@127.0.0.1:5432/srep',
  'postgres://srep:srep@127.0.0.1:5432/postgres',
  'postgres://srep@127.0.0.1:5432/srep',
  'postgres://srep@127.0.0.1:5432/postgres',
];

async function openUrl(): Promise<string | null> {
  for (const url of CANDIDATES) {
    if (url === undefined || !url.startsWith('postgres')) {
      continue;
    }
    const sql = postgres(url, { max: 1, connect_timeout: 2, onnotice: () => {} });
    try {
      await sql`select 1`;
      await sql.end({ timeout: 2 });
      return url;
    } catch {
      await sql.end({ timeout: 1 }).catch(() => undefined);
    }
  }
  return null;
}

describe('postgres cache across connections', () => {
  it('reloads when another connection commits', async (ctx) => {
    const url = await openUrl();
    if (url === null) {
      ctx.skip();
      return;
    }
    const reader = postgres(url, { max: 1, connect_timeout: 2, onnotice: () => {} });
    const writer = postgres(url, { max: 1, connect_timeout: 2, onnotice: () => {} });
    const table = `cache_probe_${crypto.randomUUID().replaceAll('-', '')}`;
    const db = drizzle(reader);
    let loads = 0;
    const read = () =>
      readCached(db, 'decks', async () => {
        loads += 1;
        const rows = await reader.unsafe(`select name from ${table} where id = 1`);
        const row = rows[0] as { name: string } | undefined;
        return row?.name;
      });
    try {
      await reader.unsafe(`create table ${table} (id int primary key, name text)`);
      await reader.unsafe(`insert into ${table} (id, name) values (1, 'old')`);
      expect(await read()).toBe('old');
      expect(await read()).toBe('old');
      expect(loads).toBe(1);
      await reader.unsafe('select 1');
      expect(await read()).toBe('old');
      expect(loads).toBe(1);
      await writer.unsafe(`update ${table} set name = 'new' where id = 1`);
      expect(await read()).toBe('new');
      expect(loads).toBe(2);
    } finally {
      await reader.unsafe(`drop table if exists ${table}`).catch(() => undefined);
      await reader.end({ timeout: 2 });
      await writer.end({ timeout: 2 });
    }
  });
});
