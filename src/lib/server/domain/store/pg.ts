import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createPgDeckStore } from '#lib/server/domain/store/decks.pg.js';
import { createPgNoteTypeStore } from '#lib/server/domain/store/note-types.pg.js';
import { createPgNoteStore } from '#lib/server/domain/store/notes.pg.js';
import { createPgPresetMediaStore } from '#lib/server/domain/store/presets-media.pg.js';
import type { DomainStore } from '#lib/server/domain/store/store-types.js';

// Postgres transactions are async. The callbacks from the core stay pure and synchronous.
export function createPgDomainStore(db: PostgresJsDatabase): DomainStore {
  return {
    ...createPgPresetMediaStore(db),
    ...createPgDeckStore(db),
    ...createPgNoteTypeStore(db),
    ...createPgNoteStore(db),
  };
}
