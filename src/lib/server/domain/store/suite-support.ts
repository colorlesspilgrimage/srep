import { sql, type SQL } from 'drizzle-orm';
import { BASIC_CARD_ID, BASIC_ID, DEFAULT_PRESET_ID } from '#lib/server/domain/builtin.js';
import { pathOf } from '#lib/server/domain/core/deck-paths.js';
import type { CardDraft, DeckRow, NoteRow } from '#lib/server/domain/store/store-types.js';
import type { DomainHarness } from '#lib/server/domain/test-support/harness.js';

export type MakeHarness = () => Promise<DomainHarness>;

export function deckRow(id: string, name: string, parent: DeckRow | null = null): DeckRow {
  return {
    id,
    parentId: parent?.id ?? null,
    name,
    path: pathOf(parent, name),
    presetId: DEFAULT_PRESET_ID,
    description: '',
    archivedAt: null,
  };
}

export function noteRow(id: string, extra: Partial<NoteRow> = {}): NoteRow {
  return {
    id,
    noteTypeId: BASIC_ID,
    guid: `g-${id}`,
    fields: ['front', 'back'],
    createdAt: 1,
    updatedAt: 1,
    checksum: 'sum',
    deletedAt: null,
    ...extra,
  };
}

export function draft(
  id: string,
  deckId: string,
  ordinal = 0,
  templateId = BASIC_CARD_ID,
): CardDraft {
  return { id, templateId, ordinal, deckId };
}

// Adds a note with its cards. The cards are Basic cards with ordinals 0, 1, 2 ...
export async function addNote(
  h: DomainHarness,
  id: string,
  deckIds: string[],
  extra: Partial<NoteRow> = {},
): Promise<void> {
  const cards = deckIds.map((deckId, i) => draft(`${id}-c${i}`, deckId, i));
  await h.store.insertNote({ note: noteRow(id, extra), tags: ['t'], cards, now: 5 });
}

// Runs a statement on either dialect. Tests use it to set state that M2 never writes.
export async function execSql(h: DomainHarness, query: SQL): Promise<void> {
  if (h.handle.dialect === 'sqlite') {
    h.handle.db.run(query);
  } else {
    await h.handle.db.execute(query);
  }
}

export async function countRows(h: DomainHarness, table: string): Promise<number> {
  const query = sql`select count(*) as n from ${sql.identifier(table)}`;
  if (h.handle.dialect === 'sqlite') {
    return Number(h.handle.db.get<{ n: number }>(query).n);
  }
  const rows = await h.handle.db.execute<{ n: number }>(query);
  return Number(rows[0]?.n);
}

export async function insertReviewLog(h: DomainHarness, id: string, cardId: string): Promise<void> {
  await execSql(
    h,
    sql`insert into review_log (id, card_id, reviewed_at, rating, state_before, due_before,
      stability_before, difficulty_before, elapsed_ms, interval_after)
      values (${id}, ${cardId}, 1, 3, 'new', 1, 0, 0, 1000, 1)`,
  );
}
