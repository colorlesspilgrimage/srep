import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { isPgUniqueViolation } from '#lib/server/domain/store/errors.js';
import type { PresetMediaStore } from '#lib/server/domain/store/presets-media.sqlite.js';
import { chunk } from '#lib/server/domain/store/shared.js';
import type { DomainStore, MediaRow, PresetRow } from '#lib/server/domain/store/store-types.js';
import { cardTemplate, deck, deckPreset, media, noteType } from '#lib/server/db/schema/pg.js';

type Exec = Pick<PostgresJsDatabase, 'select' | 'insert' | 'update' | 'delete'>;

// Drizzle writes a JS null as SQL NULL. The column is NOT NULL and keeps JSON null.
function presetValues(row: PresetRow) {
  return { ...row, fsrsParams: row.fsrsParams ?? sql`'null'::jsonb` };
}

async function nameTaken(tx: Exec, name: string, exceptId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: deckPreset.id })
    .from(deckPreset)
    .where(and(eq(deckPreset.name, name), ne(deckPreset.id, exceptId)));
  return rows.length > 0;
}

async function seedNoteTypes(tx: Exec, seed: Parameters<DomainStore['seedDefaults']>[0]) {
  for (const { noteType: row, templates } of seed.noteTypes) {
    await tx.insert(noteType).values(row).onConflictDoNothing();
    // A user type with the same name blocks the seed row. Then no template is added.
    const found = await tx.select().from(noteType).where(eq(noteType.id, row.id));
    if (found.length === 0) {
      continue;
    }
    for (const template of templates) {
      await tx.insert(cardTemplate).values(template).onConflictDoNothing();
    }
  }
}

async function catchNameTaken<T>(run: () => Promise<T>): Promise<T | 'name_taken'> {
  try {
    return await run();
  } catch (error) {
    if (isPgUniqueViolation(error)) {
      return 'name_taken';
    }
    throw error;
  }
}

export function createPgPresetMediaStore(db: PostgresJsDatabase): PresetMediaStore {
  return {
    async seedDefaults(seed) {
      await db.transaction(async (tx) => {
        await tx.insert(deckPreset).values(presetValues(seed.preset)).onConflictDoNothing();
        await seedNoteTypes(tx, seed);
      });
    },

    async listPresets() {
      return db.select().from(deckPreset).orderBy(asc(deckPreset.name));
    },

    async getPreset(id) {
      const rows = await db.select().from(deckPreset).where(eq(deckPreset.id, id));
      return rows[0];
    },

    async insertPreset(row) {
      return catchNameTaken(() =>
        db.transaction(async (tx) => {
          if (await nameTaken(tx, row.name, row.id)) {
            return 'name_taken' as const;
          }
          await tx.insert(deckPreset).values(presetValues(row));
          return 'ok' as const;
        }),
      );
    },

    async updatePreset(row) {
      return catchNameTaken(() =>
        db.transaction(async (tx) => {
          const found = await tx.select().from(deckPreset).where(eq(deckPreset.id, row.id));
          if (found.length === 0) {
            return 'not_found' as const;
          }
          if (await nameTaken(tx, row.name, row.id)) {
            return 'name_taken' as const;
          }
          await tx.update(deckPreset).set(presetValues(row)).where(eq(deckPreset.id, row.id));
          return 'ok' as const;
        }),
      );
    },

    async deletePresetUnlessUsed(id) {
      return db.transaction(async (tx) => {
        const found = await tx.select().from(deckPreset).where(eq(deckPreset.id, id));
        if (found.length === 0) {
          return 'not_found';
        }
        const used = await tx
          .select({ id: deck.id })
          .from(deck)
          .where(eq(deck.presetId, id))
          .limit(1);
        if (used.length > 0) {
          return 'in_use';
        }
        await tx.delete(deckPreset).where(eq(deckPreset.id, id));
        return 'deleted';
      });
    },

    async insertMediaIfAbsent(row) {
      return db.transaction(async (tx) => {
        await tx.insert(media).values(row).onConflictDoNothing({ target: media.sha256 });
        const rows = await tx.select().from(media).where(eq(media.sha256, row.sha256));
        // The row exists now: this call or an earlier call inserted it.
        return rows[0] as MediaRow;
      });
    },

    async getMediaBySha(sha) {
      const rows = await db.select().from(media).where(eq(media.sha256, sha));
      return rows[0];
    },

    async findMissingMedia(shas) {
      const wanted = [...new Set(shas)];
      const found = new Set<string>();
      for (const part of chunk(wanted)) {
        const rows = await db
          .select({ sha: media.sha256 })
          .from(media)
          .where(inArray(media.sha256, part));
        rows.forEach((r) => found.add(r.sha));
      }
      return wanted.filter((sha) => !found.has(sha));
    },
  };
}
