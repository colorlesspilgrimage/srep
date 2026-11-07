import { asc } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
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
} from '#lib/server/db/schema/sqlite.js';
import type { NativeManifest } from '#lib/server/import-export/types.js';
import { NATIVE_MANIFEST_VERSION } from '#lib/server/import-export/types.js';

const AUTH_SETTING_PREFIX = 'auth.';

export function readSqliteSnapshot(db: BetterSQLite3Database, exportedAt: number): NativeManifest {
  const presets = db.select().from(deckPreset).orderBy(asc(deckPreset.name)).all();
  const decks = db.select().from(deck).orderBy(asc(deck.path)).all();
  const noteTypes = withTemplates(
    db.select().from(noteType).orderBy(asc(noteType.name)).all(),
    db
      .select()
      .from(cardTemplate)
      .orderBy(asc(cardTemplate.noteTypeId), asc(cardTemplate.ordinal))
      .all(),
  );
  const notes = db.select().from(note).orderBy(asc(note.id)).all();
  const noteTags = db
    .select({ noteId: noteTag.noteId, tag: noteTag.tag })
    .from(noteTag)
    .orderBy(asc(noteTag.noteId), asc(noteTag.tag))
    .all();
  const cards = db.select().from(card).orderBy(asc(card.position)).all();
  const reviewLogs = db
    .select()
    .from(reviewLog)
    .orderBy(asc(reviewLog.reviewedAt), asc(reviewLog.id))
    .all();
  const mediaRows = db.select().from(media).orderBy(asc(media.sha256)).all();
  const settings = db
    .select()
    .from(appSettings)
    .all()
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
