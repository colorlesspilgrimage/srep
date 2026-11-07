import { asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { isPgUniqueViolation } from '#lib/server/domain/store/errors.js';
import type { NoteTypeStore } from '#lib/server/domain/store/note-types.sqlite.js';
import { withTemplates } from '#lib/server/domain/store/shared.js';
import { cardTemplate, note, noteType } from '#lib/server/db/schema/pg.js';

export function createPgNoteTypeStore(db: PostgresJsDatabase): NoteTypeStore {
  return {
    async listNoteTypes() {
      return db.transaction(async (tx) =>
        withTemplates(
          await tx.select().from(noteType).orderBy(asc(noteType.name)),
          await tx.select().from(cardTemplate),
        ),
      );
    },

    async getNoteType(id) {
      return db.transaction(async (tx) => {
        const [row] = await tx.select().from(noteType).where(eq(noteType.id, id));
        if (row === undefined) {
          return undefined;
        }
        const templates = await tx
          .select()
          .from(cardTemplate)
          .where(eq(cardTemplate.noteTypeId, id));
        return withTemplates([row], templates)[0];
      });
    },

    async insertNoteType(row, templates) {
      try {
        return await db.transaction(async (tx) => {
          const clash = await tx.select().from(noteType).where(eq(noteType.name, row.name));
          if (clash.length > 0) {
            return 'name_taken' as const;
          }
          await tx.insert(noteType).values(row);
          if (templates.length > 0) {
            await tx.insert(cardTemplate).values(templates);
          }
          return 'ok' as const;
        });
      } catch (error) {
        if (isPgUniqueViolation(error)) {
          return 'name_taken';
        }
        throw error;
      }
    },

    async deleteNoteTypeUnlessUsed(id) {
      return db.transaction(async (tx) => {
        const found = await tx.select().from(noteType).where(eq(noteType.id, id));
        if (found.length === 0) {
          return 'not_found';
        }
        const used = await tx
          .select({ id: note.id })
          .from(note)
          .where(eq(note.noteTypeId, id))
          .limit(1);
        if (used.length > 0) {
          return 'in_use';
        }
        await tx.delete(noteType).where(eq(noteType.id, id));
        return 'deleted';
      });
    },
  };
}
