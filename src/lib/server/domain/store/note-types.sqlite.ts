import { asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { isSqliteUniqueViolation } from '#lib/server/domain/store/errors.js';
import { withTemplates } from '#lib/server/domain/store/shared.js';
import type { DomainStore } from '#lib/server/domain/store/store-types.js';
import { cardTemplate, note, noteType } from '#lib/server/db/schema/sqlite.js';

export type NoteTypeStore = Pick<
  DomainStore,
  'listNoteTypes' | 'getNoteType' | 'insertNoteType' | 'deleteNoteTypeUnlessUsed'
>;

export function createSqliteNoteTypeStore(db: BetterSQLite3Database): NoteTypeStore {
  return {
    async listNoteTypes() {
      return db.transaction((tx) =>
        withTemplates(
          tx.select().from(noteType).orderBy(asc(noteType.name)).all(),
          tx.select().from(cardTemplate).all(),
        ),
      );
    },

    async getNoteType(id) {
      return db.transaction((tx) => {
        const row = tx.select().from(noteType).where(eq(noteType.id, id)).get();
        if (row === undefined) {
          return undefined;
        }
        const templates = tx
          .select()
          .from(cardTemplate)
          .where(eq(cardTemplate.noteTypeId, id))
          .all();
        return withTemplates([row], templates)[0];
      });
    },

    async insertNoteType(row, templates) {
      try {
        return db.transaction((tx) => {
          const clash = tx.select().from(noteType).where(eq(noteType.name, row.name)).get();
          if (clash !== undefined) {
            return 'name_taken' as const;
          }
          tx.insert(noteType).values(row).run();
          for (const template of templates) {
            tx.insert(cardTemplate).values(template).run();
          }
          return 'ok' as const;
        });
      } catch (error) {
        if (isSqliteUniqueViolation(error)) {
          return 'name_taken';
        }
        throw error;
      }
    },

    async deleteNoteTypeUnlessUsed(id) {
      return db.transaction((tx) => {
        if (tx.select().from(noteType).where(eq(noteType.id, id)).get() === undefined) {
          return 'not_found';
        }
        if (tx.select({ id: note.id }).from(note).where(eq(note.noteTypeId, id)).get()) {
          return 'in_use';
        }
        tx.delete(noteType).where(eq(noteType.id, id)).run();
        return 'deleted';
      });
    },
  };
}
