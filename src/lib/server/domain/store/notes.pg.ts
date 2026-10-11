import { and, asc, eq, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FLAG_ORPHANED } from '#lib/server/domain/core/card-plan.js';
import type { NoteStore } from '#lib/server/domain/store/notes.sqlite.js';
import { chunk, newCard } from '#lib/server/domain/store/shared.js';
import type { CardDraft, NoteState } from '#lib/server/domain/store/store-types.js';
import { card, deck, note, noteTag } from '#lib/server/db/schema/pg.js';

type Exec = Pick<PostgresJsDatabase, 'select' | 'insert' | 'update' | 'delete'>;

// New cards go to the end of the global order. The caller runs this in its transaction.
async function insertCards(tx: Exec, noteId: string, drafts: CardDraft[], now: number) {
  const rows = await tx
    .select({ value: sql<number>`coalesce(max(${card.position}), -1) + 1` })
    .from(card);
  // Postgres can return an aggregate as a string. Number() makes it a number.
  let position = Number(rows[0]?.value ?? 0);
  for (const draft of drafts) {
    await tx.insert(card).values(newCard(draft, noteId, now, position));
    position += 1;
  }
}

async function insertTags(tx: Exec, noteId: string, tags: string[]): Promise<void> {
  if (tags.length > 0) {
    await tx.insert(noteTag).values(tags.map((tag) => ({ noteId, tag })));
  }
}

async function readState(tx: Exec, id: string): Promise<NoteState | undefined> {
  const [row] = await tx.select().from(note).where(eq(note.id, id));
  if (row === undefined) {
    return undefined;
  }
  const tagRows = await tx
    .select({ tag: noteTag.tag })
    .from(noteTag)
    .where(eq(noteTag.noteId, id))
    .orderBy(asc(noteTag.tag));
  const cards = await tx.select().from(card).where(eq(card.noteId, id)).orderBy(asc(card.position));
  return { note: row, tags: tagRows.map((t) => t.tag), cards };
}

// The flag is a constant, not user text, so it can go into the SQL as is.
const ORPHAN_BIT = sql.raw(String(FLAG_ORPHANED));

async function setFlags(tx: Exec, ids: string[], orphan: boolean): Promise<void> {
  for (const part of chunk(ids)) {
    const set = orphan
      ? { state: 'suspended' as const, flags: sql`${card.flags} | ${ORPHAN_BIT}` }
      : { flags: sql`${card.flags} & ~${ORPHAN_BIT}` };
    await tx.update(card).set(set).where(inArray(card.id, part));
  }
}

async function deckExists(tx: Exec, id: string): Promise<boolean> {
  const rows = await tx.select({ id: deck.id }).from(deck).where(eq(deck.id, id));
  return rows.length > 0;
}

export function createPgNoteStore(db: PostgresJsDatabase): NoteStore {
  return {
    async insertNote({ note: row, tags, cards, now }) {
      await db.transaction(async (tx) => {
        await tx.insert(note).values(row);
        await insertTags(tx, row.id, tags);
        await insertCards(tx, row.id, cards, now);
      });
    },

    async updateNote(id, compute) {
      return db.transaction(async (tx) => {
        const state = await readState(tx, id);
        if (state === undefined || state.note.deletedAt !== null) {
          return 'not_found' as const;
        }
        const change = compute(state);
        if (!change.ok) {
          return change;
        }
        await tx
          .update(note)
          .set({ fields: change.fields, checksum: change.checksum, updatedAt: change.updatedAt })
          .where(eq(note.id, id));
        await tx.delete(noteTag).where(eq(noteTag.noteId, id));
        await insertTags(tx, id, change.tags);
        for (const part of chunk(change.deleteIds)) {
          await tx.delete(card).where(inArray(card.id, part));
        }
        await setFlags(tx, change.orphanIds, true);
        await setFlags(tx, change.unorphanIds, false);
        await insertCards(tx, id, change.create, change.updatedAt);
        return { ok: true as const };
      });
    },

    async getNoteState(id) {
      return db.transaction(async (tx) => readState(tx, id));
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
      const rows = await db
        .select({ id: note.id })
        .from(note)
        .where(and(...conditions))
        .orderBy(asc(note.createdAt), asc(note.id));
      return rows.map((r) => r.id);
    },

    async trashNote(id, now) {
      const rows = await db
        .update(note)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(note.id, id), isNull(note.deletedAt)))
        .returning({ id: note.id });
      return rows.length > 0;
    },

    async restoreNote(id, deckId, now) {
      return db.transaction(async (tx) => {
        const [row] = await tx.select().from(note).where(eq(note.id, id));
        if (row === undefined) {
          return 'not_found';
        }
        if (row.deletedAt === null) {
          return 'not_trashed';
        }
        const homeless = and(eq(card.noteId, id), isNull(card.deckId));
        const missing = await tx.select({ id: card.id }).from(card).where(homeless).limit(1);
        if (missing.length > 0) {
          if (deckId === undefined) {
            return 'deck_required';
          }
          if (!(await deckExists(tx, deckId))) {
            return 'deck_not_found';
          }
          await tx.update(card).set({ deckId }).where(homeless);
        }
        await tx.update(note).set({ deletedAt: null, updatedAt: now }).where(eq(note.id, id));
        return 'ok';
      });
    },

    async moveCards(cardIds, deckId) {
      const ids = [...new Set(cardIds)];
      return db.transaction(async (tx) => {
        if (!(await deckExists(tx, deckId))) {
          return 'deck_not_found';
        }
        let found = 0;
        for (const part of chunk(ids)) {
          found += (await tx.select({ id: card.id }).from(card).where(inArray(card.id, part)))
            .length;
        }
        if (found !== ids.length) {
          return 'card_not_found';
        }
        for (const part of chunk(ids)) {
          await tx.update(card).set({ deckId }).where(inArray(card.id, part));
        }
        return 'ok';
      });
    },

    async purgeTrash(olderThan) {
      const rows = await db
        .delete(note)
        .where(and(isNotNull(note.deletedAt), lte(note.deletedAt, olderThan)))
        .returning({ id: note.id });
      return rows.length;
    },
  };
}
