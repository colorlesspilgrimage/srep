import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createSqliteDeckStore } from '#lib/server/domain/store/decks.sqlite.js';
import { createSqliteNoteTypeStore } from '#lib/server/domain/store/note-types.sqlite.js';
import { createSqliteNoteStore } from '#lib/server/domain/store/notes.sqlite.js';
import { createSqlitePresetMediaStore } from '#lib/server/domain/store/presets-media.sqlite.js';
import type { DomainStore } from '#lib/server/domain/store/store-types.js';

// better-sqlite3 transactions are synchronous. Each part uses pure callbacks only.
export function createSqliteDomainStore(db: BetterSQLite3Database): DomainStore {
  return {
    ...createSqlitePresetMediaStore(db),
    ...createSqliteDeckStore(db),
    ...createSqliteNoteTypeStore(db),
    ...createSqliteNoteStore(db),
  };
}
