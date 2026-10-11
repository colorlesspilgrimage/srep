import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { fail } from '#lib/server/auth/deps.js';
import { depthOf, subtreeIds } from '#lib/server/domain/core/deck-paths.js';
import { isSqliteUniqueViolation } from '#lib/server/domain/store/errors.js';
import { chunk } from '#lib/server/domain/store/shared.js';
import type { DeckRow, DomainStore } from '#lib/server/domain/store/store-types.js';
import { card, deck, note } from '#lib/server/db/schema/sqlite.js';

type Exec = Pick<BetterSQLite3Database, 'select' | 'insert' | 'update' | 'delete'>;

export type DeckStore = Pick<
  DomainStore,
  'listDecks' | 'getDeck' | 'insertDeck' | 'changeDecks' | 'deckImpact' | 'deleteDeckTree'
>;

function cardNoteIds(tx: Exec, deckIds: string[]): string[] {
  return chunk(deckIds).flatMap((ids) =>
    tx
      .select({ noteId: card.noteId })
      .from(card)
      .where(inArray(card.deckId, ids))
      .all()
      .map((row) => row.noteId),
  );
}

// Deletes the decks deepest first. A parent row then never loses a child too late.
function deleteDecks(tx: Exec, all: DeckRow[], ids: string[]): void {
  const depth = new Map(all.map((d) => [d.id, depthOf(d.path)]));
  const ordered = [...ids].sort((a, b) => (depth.get(b) ?? 0) - (depth.get(a) ?? 0));
  for (const part of chunk(ordered)) {
    tx.delete(deck).where(inArray(deck.id, part)).run();
  }
}

function trashNotesOf(tx: Exec, ids: string[], now: number): void {
  const noteIds = [...new Set(cardNoteIds(tx, ids))];
  for (const part of chunk(noteIds)) {
    tx.update(note)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(inArray(note.id, part), isNull(note.deletedAt)))
      .run();
  }
}

export function createSqliteDeckStore(db: BetterSQLite3Database): DeckStore {
  return {
    async listDecks() {
      return db.select().from(deck).orderBy(asc(deck.path)).all();
    },

    async getDeck(id) {
      return db.select().from(deck).where(eq(deck.id, id)).get();
    },

    async insertDeck(row) {
      try {
        db.insert(deck).values(row).run();
        return 'ok';
      } catch (error) {
        if (isSqliteUniqueViolation(error)) {
          return 'name_taken';
        }
        throw error;
      }
    },

    async changeDecks(compute) {
      try {
        return db.transaction((tx) => {
          const change = compute(tx.select().from(deck).all());
          if (change.ok) {
            for (const row of change.updates) {
              tx.update(deck).set(row).where(eq(deck.id, row.id)).run();
            }
          }
          return change;
        });
      } catch (error) {
        if (isSqliteUniqueViolation(error)) {
          return fail(409, 'deck_name_taken');
        }
        throw error;
      }
    },

    async deckImpact(rootId) {
      return db.transaction((tx) => {
        const ids = subtreeIds(tx.select().from(deck).all(), rootId);
        if (ids.length === 0) {
          return undefined;
        }
        const noteIds = cardNoteIds(tx, ids);
        return { decks: ids.length, cards: noteIds.length, notes: new Set(noteIds).size };
      });
    },

    async deleteDeckTree(rootId, action, now) {
      return db.transaction((tx) => {
        const all = tx.select().from(deck).all();
        const ids = subtreeIds(all, rootId);
        if (ids.length === 0) {
          return 'not_found';
        }
        if (action.kind === 'move') {
          if (!all.some((d) => d.id === action.targetDeckId)) {
            return 'target_not_found';
          }
          if (ids.includes(action.targetDeckId)) {
            return 'target_in_subtree';
          }
          for (const part of chunk(ids)) {
            tx.update(card)
              .set({ deckId: action.targetDeckId })
              .where(inArray(card.deckId, part))
              .run();
          }
        } else {
          trashNotesOf(tx, ids, now);
        }
        deleteDecks(tx, all, ids);
        return 'ok';
      });
    },
  };
}
