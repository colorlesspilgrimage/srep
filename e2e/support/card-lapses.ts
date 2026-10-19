// Sets card.lapses on the end-to-end database.
// The URL is E2E_DATABASE_URL. When that variable is empty, the URL is sqlite:./data/e2e.db.
// The statement binds the card id. The same call works for SQLite and Postgres.

import { sql } from 'drizzle-orm';
import { parseConfig } from '../../src/lib/server/config.js';
import { createDb, type DbHandle } from '../../src/lib/server/db/client.js';

function e2eDatabaseUrl(): string {
  const raw = process.env.E2E_DATABASE_URL;
  if (raw !== undefined && raw.length > 0) {
    return raw;
  }
  return 'sqlite:./data/e2e.db';
}

async function updatedRowCount(handle: DbHandle, cardId: string, lapses: number): Promise<number> {
  const query = sql`update card set lapses = ${lapses} where id = ${cardId} returning id`;
  if (handle.dialect === 'sqlite') {
    return handle.db.all<{ id: string }>(query).length;
  }
  const rows = await handle.db.execute<{ id: string }>(query);
  return rows.length;
}

export async function setCardLapses(cardId: string, lapses: number): Promise<void> {
  if (!Number.isInteger(lapses) || lapses < 0) {
    throw new Error('lapses must be a whole number');
  }
  const handle = createDb(parseConfig({ SREP_DATABASE_URL: e2eDatabaseUrl() }));
  try {
    const count = await updatedRowCount(handle, cardId, lapses);
    if (count !== 1) {
      throw new Error('lapse update missed');
    }
  } finally {
    await handle.close();
  }
}
