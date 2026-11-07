import type { DbHandle } from '#lib/server/db/client.js';
import { createPgDomainStore } from '#lib/server/domain/store/pg.js';
import { createSqliteDomainStore } from '#lib/server/domain/store/sqlite.js';
import type { DomainStore } from '#lib/server/domain/store/store-types.js';

export function getDomainStore(handle: DbHandle): DomainStore {
  return handle.dialect === 'sqlite'
    ? createSqliteDomainStore(handle.db)
    : createPgDomainStore(handle.db);
}
