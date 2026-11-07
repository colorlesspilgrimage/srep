import { createPgStore } from '#lib/server/auth/store.pg.js';
import { createSqliteStore } from '#lib/server/auth/store.sqlite.js';
import type { AuthStore } from '#lib/server/auth/store-types.js';
import type { DbHandle } from '#lib/server/db/client.js';

export * from '#lib/server/auth/store-types.js';

export function getAuthStore(handle: DbHandle): AuthStore {
  return handle.dialect === 'sqlite' ? createSqliteStore(handle.db) : createPgStore(handle.db);
}
