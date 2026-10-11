import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { isSqliteUniqueViolation } from '#lib/server/domain/store/errors.js';
import { chunk } from '#lib/server/domain/store/shared.js';
import type { DomainStore, MediaRow, PresetRow } from '#lib/server/domain/store/store-types.js';
import { cardTemplate, deck, deckPreset, media, noteType } from '#lib/server/db/schema/sqlite.js';

type Exec = Pick<BetterSQLite3Database, 'select' | 'insert' | 'update' | 'delete'>;

export type PresetMediaStore = Pick<
  DomainStore,
  | 'seedDefaults'
  | 'listPresets'
  | 'getPreset'
  | 'insertPreset'
  | 'updatePreset'
  | 'deletePresetUnlessUsed'
  | 'insertMediaIfAbsent'
  | 'getMediaBySha'
  | 'findMissingMedia'
>;

// Drizzle writes a JS null as SQL NULL. The column is NOT NULL and keeps JSON null.
function presetValues(row: PresetRow) {
  return { ...row, fsrsParams: row.fsrsParams ?? sql`'null'` };
}

function nameTaken(tx: Exec, name: string, exceptId: string): boolean {
  const row = tx
    .select({ id: deckPreset.id })
    .from(deckPreset)
    .where(and(eq(deckPreset.name, name), ne(deckPreset.id, exceptId)))
    .get();
  return row !== undefined;
}

function seedNoteTypes(tx: Exec, seed: Parameters<DomainStore['seedDefaults']>[0]): void {
  for (const { noteType: row, templates } of seed.noteTypes) {
    tx.insert(noteType).values(row).onConflictDoNothing().run();
    // A user type with the same name blocks the seed row. Then no template is added.
    if (tx.select().from(noteType).where(eq(noteType.id, row.id)).get() === undefined) {
      continue;
    }
    for (const template of templates) {
      tx.insert(cardTemplate).values(template).onConflictDoNothing().run();
    }
  }
}

function catchNameTaken<T>(run: () => T): T | 'name_taken' {
  try {
    return run();
  } catch (error) {
    if (isSqliteUniqueViolation(error)) {
      return 'name_taken';
    }
    throw error;
  }
}

export function createSqlitePresetMediaStore(db: BetterSQLite3Database): PresetMediaStore {
  return {
    async seedDefaults(seed) {
      db.transaction((tx) => {
        tx.insert(deckPreset).values(presetValues(seed.preset)).onConflictDoNothing().run();
        seedNoteTypes(tx, seed);
      });
    },

    async listPresets() {
      return db.select().from(deckPreset).orderBy(asc(deckPreset.name)).all();
    },

    async getPreset(id) {
      return db.select().from(deckPreset).where(eq(deckPreset.id, id)).get();
    },

    async insertPreset(row) {
      return catchNameTaken(() =>
        db.transaction((tx) => {
          if (nameTaken(tx, row.name, row.id)) {
            return 'name_taken' as const;
          }
          tx.insert(deckPreset).values(presetValues(row)).run();
          return 'ok' as const;
        }),
      );
    },

    async updatePreset(row) {
      return catchNameTaken(() =>
        db.transaction((tx) => {
          if (tx.select().from(deckPreset).where(eq(deckPreset.id, row.id)).get() === undefined) {
            return 'not_found' as const;
          }
          if (nameTaken(tx, row.name, row.id)) {
            return 'name_taken' as const;
          }
          tx.update(deckPreset).set(presetValues(row)).where(eq(deckPreset.id, row.id)).run();
          return 'ok' as const;
        }),
      );
    },

    async deletePresetUnlessUsed(id) {
      return db.transaction((tx) => {
        if (tx.select().from(deckPreset).where(eq(deckPreset.id, id)).get() === undefined) {
          return 'not_found';
        }
        if (tx.select({ id: deck.id }).from(deck).where(eq(deck.presetId, id)).get()) {
          return 'in_use';
        }
        tx.delete(deckPreset).where(eq(deckPreset.id, id)).run();
        return 'deleted';
      });
    },

    async insertMediaIfAbsent(row) {
      return db.transaction((tx) => {
        tx.insert(media).values(row).onConflictDoNothing({ target: media.sha256 }).run();
        // The row exists now: this call or an earlier call inserted it.
        return tx.select().from(media).where(eq(media.sha256, row.sha256)).get() as MediaRow;
      });
    },

    async getMediaBySha(sha) {
      return db.select().from(media).where(eq(media.sha256, sha)).get();
    },

    async findMissingMedia(shas) {
      const wanted = [...new Set(shas)];
      const found = new Set(
        chunk(wanted).flatMap((part) =>
          db
            .select({ sha: media.sha256 })
            .from(media)
            .where(inArray(media.sha256, part))
            .all()
            .map((r) => r.sha),
        ),
      );
      return wanted.filter((sha) => !found.has(sha));
    },
  };
}
