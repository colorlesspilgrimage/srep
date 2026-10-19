// Sets lapses for one card. The browse end-to-end helper starts this file with tsx.
// Input: a UUID and a whole number. Output: exit 0, or exit 1 when the row is missing.
// Database: SREP_DATABASE_URL. The helper sets that from E2E_DATABASE_URL.
// The statement binds the card id. SQLite and Postgres both accept it.

import { sql } from 'drizzle-orm';
import { parseConfig } from '#lib/server/config.js';
import { createDb, type DbHandle } from '#lib/server/db/client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LAPSES = 1_000_000;

function readArgs(): { cardId: string; lapses: number } {
  const cardId = process.argv[2] ?? '';
  const lapses = Number(process.argv[3]);
  if (!UUID.test(cardId) || !Number.isInteger(lapses) || lapses < 0 || lapses > MAX_LAPSES) {
    throw new Error('lapse update missed');
  }
  return { cardId, lapses };
}

async function updatedRowCount(handle: DbHandle, cardId: string, lapses: number): Promise<number> {
  const query = sql`update card set lapses = ${lapses} where id = ${cardId} returning id`;
  if (handle.dialect === 'sqlite') {
    return handle.db.all<{ id: string }>(query).length;
  }
  const rows = await handle.db.execute<{ id: string }>(query);
  return rows.length;
}

async function main(): Promise<void> {
  const url = process.env.SREP_DATABASE_URL;
  if (url === undefined || url.length === 0) {
    throw new Error('lapse update missed');
  }
  const { cardId, lapses } = readArgs();
  const handle = createDb(parseConfig({ SREP_DATABASE_URL: url }));
  try {
    const count = await updatedRowCount(handle, cardId, lapses);
    if (count !== 1) {
      throw new Error('lapse update missed');
    }
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'lapse update missed';
  console.error(message.replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgres://'));
  process.exitCode = 1;
});
