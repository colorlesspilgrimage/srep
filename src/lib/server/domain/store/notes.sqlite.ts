import { and, asc, eq, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { FLAG_ORPHANED } from '#lib/server/domain/core/card-plan.js';
import { chunk, newCard } from '#lib/server/domain/store/shared.js';
import type { CardDraft, DomainStore, NoteState } from '#lib/server/domain/store/store-types.js';
import { card, deck, note, noteTag } from '#lib/server/db/schema/sqlite.js';

type Exec = Pick<BetterSQLite3Database, 'select' | 'insert' | 'update' | 'delete'>;

export type NoteStore = Pick<
  DomainStore,
  | 'insertNote'
  | 'updateNote'
  | 'getNoteState'
  | 'findNoteIdsByChecksum'
  | 'trashNote'
  | 'restoreNote'
  | 'moveCards'
  | 'purgeTrash'
>;

// New cards go to the end of the global order. The caller runs this in its transaction.
function insertCards(tx: Exec, noteId: string, drafts: CardDraft[], now: number): void {
  const next = tx
    .select({ value: sql<number>`coalesce(max(${card.position}), -1) + 1` })
    .from(card)
    .get();
  let position = Number(next?.value ?? 0);
  for (const draft of drafts) {
    tx.insert(card)
      .values(newCard(draft, noteId, now, position))
      .run();
    position += 1;
  }
}

function insertTags(tx: Exec, noteId: string, tags: string[]): void {
  for (const tag of tags) {
    tx.insert(noteTag).values({ noteId, tag }).run();
  }
}

function readState(tx: Exec, id: string): NoteState | undefined {
  const row = tx.select().from(note).where(eq(note.id, id)).get();
  if (row === undefined) {
    return undefined;
  }
  const tags = tx
    .select({ tag: noteTag.tag })
    .from(noteTag)
    .where(eq(noteTag.noteId, id))
    .orderBy(asc(noteTag.tag))
    .all()
    .map((t) => t.tag);
  const cards = tx.select().from(card).where(eq(card.noteId, id)).orderBy(asc(card.position)).all();
  return { note: row, tags, cards };
}

// The flag is a constant, not user text, so it can go into the SQL as is.
const ORPHAN_BIT = sql.raw(String(FLAG_ORPHANED));

function setFlags(tx: Exec, ids: string[], orphan: boolean): void {
  for (const part of chunk(ids)) {
    const set = orphan
      ? { state: 'suspended' as const, flags: sql`${card.flags} | ${ORPHAN_BIT}` }
      : { flags: sql`${card.flags} & ~${ORPHAN_BIT}` };
    tx.update(card).set(set).where(inArray(card.id, part)).run();
  }
}

function deckExists(tx: Exec, id: string): boolean {
  return tx.select({ id: deck.id }).from(deck).where(eq(deck.id, id)).get() !== undefined;
}

export function createSqliteNoteStore(db: BetterSQLite3Database): NoteStore {
  return {
    async insertNote({ note: row, tags, cards, now }) {
      db.transaction((tx) => {
        tx.insert(note).values(row).run();
        insertTags(tx, row.id, tags);
        insertCards(tx, row.id, cards, now);
      });
    },

    async updateNote(id, compute) {
      return db.transaction((tx) => {
        const state = readState(tx, id);
        if (state === undefined || state.note.deletedAt !== null) {
          return 'not_found' as const;
        }
        const change = compute(state);
        if (!change.ok) {
          return change;
        }
        tx.update(note)
          .set({ fields: change.fields, checksum: change.checksum, updatedAt: change.updatedAt })
          .where(eq(note.id, id))
          .run();
        tx.delete(noteTag).where(eq(noteTag.noteId, id)).run();
        insertTags(tx, id, change.tags);
        for (const part of chunk(change.deleteIds)) {
          tx.delete(card).where(inArray(card.id, part)).run();
        }
        setFlags(tx, change.orphanIds, true);
        setFlags(tx, change.unorphanIds, false);
        insertCards(tx, id, change.create, change.updatedAt);
        return { ok: true as const };
      });
    },

    async getNoteState(id) {
      return db.transaction((tx) => readState(tx, id));
    },

    async findNoteIdsByChecksum(noteTypeId, checksum, excludeId) {
      const conditions = [
        eq(note.noteTypeId, noteTypeId),
        eq(note.checksum, checksum),
        isNull(note.deletedAt),
      ];
      if (excludeId !== undefined) {
        conditions.push(ne(note.id, excludeId));
      }
      const rows = db
        .select({ id: note.id })
        .from(note)
        .where(and(...conditions))
        .orderBy(asc(note.createdAt), asc(note.id))
        .all();
      return rows.map((r) => r.id);
    },

    async trashNote(id, now) {
      const result = db
        .update(note)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(note.id, id), isNull(note.deletedAt)))
        .run();
      return result.changes > 0;
    },

    async restoreNote(id, deckId, now) {
      return db.transaction((tx) => {
        const row = tx.select().from(note).where(eq(note.id, id)).get();
        if (row === undefined) {
          return 'not_found';
        }
        if (row.deletedAt === null) {
          return 'not_trashed';
        }
        const homeless = and(eq(card.noteId, id), isNull(card.deckId));
        if (tx.select({ id: card.id }).from(card).where(homeless).get() !== undefined) {
          if (deckId === undefined) {
            return 'deck_required';
          }
          if (!deckExists(tx, deckId)) {
            return 'deck_not_found';
          }
          tx.update(card).set({ deckId }).where(homeless).run();
        }
        tx.update(note).set({ deletedAt: null, updatedAt: now }).where(eq(note.id, id)).run();
        return 'ok';
      });
    },

    async moveCards(cardIds, deckId) {
      const ids = [...new Set(cardIds)];
      return db.transaction((tx) => {
        if (!deckExists(tx, deckId)) {
          return 'deck_not_found';
        }
        const found = chunk(ids).reduce(
          (sum, part) =>
            sum + tx.select({ id: card.id }).from(card).where(inArray(card.id, part)).all().length,
          0,
        );
        if (found !== ids.length) {
          return 'card_not_found';
        }
        for (const part of chunk(ids)) {
          tx.update(card).set({ deckId }).where(inArray(card.id, part)).run();
        }
        return 'ok';
      });
    },

    async purgeTrash(olderThan) {
      const result = db
        .delete(note)
        .where(and(isNotNull(note.deletedAt), lte(note.deletedAt, olderThan)))
        .run();
      return result.changes;
    },
  };
}
