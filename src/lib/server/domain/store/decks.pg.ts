import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { fail } from '#lib/server/auth/deps.js';
import { depthOf, subtreeIds } from '#lib/server/domain/core/deck-paths.js';
import type { DeckStore } from '#lib/server/domain/store/decks.sqlite.js';
import { isPgUniqueViolation } from '#lib/server/domain/store/errors.js';
import { chunk } from '#lib/server/domain/store/shared.js';
import type { DeckRow } from '#lib/server/domain/store/store-types.js';
import { card, deck, note } from '#lib/server/db/schema/pg.js';
import { dropCacheSlot, readCached } from '#lib/server/read-cache.js';

type Exec = Pick<PostgresJsDatabase, 'select' | 'insert' | 'update' | 'delete'>;

async function cardNoteIds(tx: Exec, deckIds: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const ids of chunk(deckIds)) {
    const rows = await tx
      .select({ noteId: card.noteId })
      .from(card)
      .where(inArray(card.deckId, ids));
    out.push(...rows.map((row) => row.noteId));
  }
  return out;
}

// Deletes the deepest decks first, so each child goes before its parent.
async function deleteDecks(tx: Exec, all: DeckRow[], ids: string[]): Promise<void> {
  const depth = new Map(all.map((d) => [d.id, depthOf(d.path)]));
  const ordered = [...ids].sort((a, b) => (depth.get(b) ?? 0) - (depth.get(a) ?? 0));
  for (const part of chunk(ordered)) {
    await tx.delete(deck).where(inArray(deck.id, part));
  }
}

async function trashNotesOf(tx: Exec, ids: string[], now: number): Promise<void> {
  const noteIds = [...new Set(await cardNoteIds(tx, ids))];
  for (const part of chunk(noteIds)) {
    await tx
      .update(note)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(inArray(note.id, part), isNull(note.deletedAt)));
  }
}

export function createPgDeckStore(db: PostgresJsDatabase): DeckStore {
  return {
    async listDecks() {
      return readCached(db, 'decks', async () => db.select().from(deck).orderBy(asc(deck.path)));
    },

    async getDeck(id) {
      const rows = await db.select().from(deck).where(eq(deck.id, id));
      return rows[0];
    },

    async insertDeck(row) {
      try {
        await db.insert(deck).values(row);
        dropCacheSlot(db, 'decks');
        return 'ok';
      } catch (error) {
        if (isPgUniqueViolation(error)) {
          return 'name_taken';
        }
        throw error;
      }
    },

    async changeDecks(compute) {
      try {
        const change = await db.transaction(async (tx) => {
          const next = compute(await tx.select().from(deck));
          if (next.ok) {
            for (const row of next.updates) {
              await tx.update(deck).set(row).where(eq(deck.id, row.id));
            }
          }
          return next;
        });
        if (change.ok && change.updates.length > 0) {
          dropCacheSlot(db, 'decks');
        }
        return change;
      } catch (error) {
        if (isPgUniqueViolation(error)) {
          return fail(409, 'deck_name_taken');
        }
        throw error;
      }
    },

    async deckImpact(rootId) {
      return db.transaction(async (tx) => {
        const ids = subtreeIds(await tx.select().from(deck), rootId);
        if (ids.length === 0) {
          return undefined;
        }
        const noteIds = await cardNoteIds(tx, ids);
        return { decks: ids.length, cards: noteIds.length, notes: new Set(noteIds).size };
      });
    },

    async deleteDeckTree(rootId, action, now) {
      const result = await db.transaction(async (tx) => {
        const all = await tx.select().from(deck);
        const ids = subtreeIds(all, rootId);
        if (ids.length === 0) {
          return 'not_found' as const;
        }
        if (action.kind === 'move') {
          if (!all.some((d) => d.id === action.targetDeckId)) {
            return 'target_not_found' as const;
          }
          if (ids.includes(action.targetDeckId)) {
            return 'target_in_subtree' as const;
          }
          for (const part of chunk(ids)) {
            await tx
              .update(card)
              .set({ deckId: action.targetDeckId })
              .where(inArray(card.deckId, part));
          }
        } else {
          await trashNotesOf(tx, ids, now);
        }
        await deleteDecks(tx, all, ids);
        return 'ok' as const;
      });
      if (result !== 'not_found') {
        dropCacheSlot(db, 'decks');
      }
      return result;
    },
  };
}
