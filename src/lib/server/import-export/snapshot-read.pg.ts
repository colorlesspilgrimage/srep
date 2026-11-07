import { asc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { withTemplates } from '#lib/server/domain/store/shared.js';
import {
  appSettings,
  card,
  cardTemplate,
  deck,
  deckPreset,
  media,
  note,
  noteTag,
  noteType,
  reviewLog,
} from '#lib/server/db/schema/pg.js';
import type { NativeManifest } from '#lib/server/import-export/types.js';
import { NATIVE_MANIFEST_VERSION } from '#lib/server/import-export/types.js';

const AUTH_SETTING_PREFIX = 'auth.';

export async function readPgSnapshot(
  db: PostgresJsDatabase,
  exportedAt: number,
): Promise<NativeManifest> {
  const presets = await db.select().from(deckPreset).orderBy(asc(deckPreset.name));
  const decks = await db.select().from(deck).orderBy(asc(deck.path));
  const noteTypes = withTemplates(
    await db.select().from(noteType).orderBy(asc(noteType.name)),
    await db
      .select()
      .from(cardTemplate)
      .orderBy(asc(cardTemplate.noteTypeId), asc(cardTemplate.ordinal)),
  );
  const notes = await db.select().from(note).orderBy(asc(note.id));
  const noteTags = await db
    .select({ noteId: noteTag.noteId, tag: noteTag.tag })
    .from(noteTag)
    .orderBy(asc(noteTag.noteId), asc(noteTag.tag));
  const cards = await db.select().from(card).orderBy(asc(card.position));
  const reviewLogs = await db
    .select()
    .from(reviewLog)
    .orderBy(asc(reviewLog.reviewedAt), asc(reviewLog.id));
  const mediaRows = await db.select().from(media).orderBy(asc(media.sha256));
  const settings = (await db.select().from(appSettings))
    .filter((row) => !row.key.startsWith(AUTH_SETTING_PREFIX))
    .map((row) => ({ key: row.key, value: row.value }));

  return {
    version: NATIVE_MANIFEST_VERSION,
    exportedAt,
    presets,
    decks,
    noteTypes: noteTypes.map((nt) => ({
      noteType: {
        id: nt.id,
        name: nt.name,
        fields: nt.fields,
        cssClass: nt.cssClass,
        sortFieldIdx: nt.sortFieldIdx,
      },
      templates: nt.templates,
    })),
    notes,
    noteTags,
    cards,
    reviewLogs,
    media: mediaRows,
    appSettings: settings,
  };
}
