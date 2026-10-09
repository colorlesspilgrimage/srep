import { getConfig } from '#lib/server/config.js';
import { createDb, type DbHandle } from '#lib/server/db/client.js';

let cached: DbHandle | undefined;

export function getDb(): DbHandle {
  if (cached === undefined) {
    cached = createDb(getConfig());
  }
  return cached;
}
