import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { chunk } from '#lib/server/domain/store/shared.js';
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
import { dropCacheSlot } from '#lib/server/read-cache.js';

type Exec = Pick<BetterSQLite3Database, 'select' | 'insert' | 'update' | 'delete'>;

function presetValues(row: NativeManifest['presets'][number]) {
  return { ...row, fsrsParams: row.fsrsParams ?? sql`'null'` };
}

function writeManifest(tx: Exec, manifest: NativeManifest): void {
  for (const row of manifest.presets) {
    tx.insert(deckPreset).values(presetValues(row)).onConflictDoNothing().run();
  }
  for (const row of manifest.decks) {
    tx.insert(deck).values(row).onConflictDoNothing().run();
  }
  for (const { noteType: row, templates } of manifest.noteTypes) {
    tx.insert(noteType).values(row).onConflictDoNothing().run();
    for (const template of templates) {
      tx.insert(cardTemplate).values(template).onConflictDoNothing().run();
    }
  }
  for (const row of manifest.media) {
    tx.insert(media).values(row).onConflictDoNothing({ target: media.sha256 }).run();
  }
  for (const part of chunk(manifest.notes)) {
    for (const row of part) {
      tx.insert(note).values(row).onConflictDoNothing().run();
    }
  }
  for (const part of chunk(manifest.noteTags)) {
    for (const row of part) {
      tx.insert(noteTag).values(row).onConflictDoNothing().run();
    }
  }
  for (const part of chunk(manifest.cards)) {
    for (const row of part) {
      tx.insert(card).values(row).onConflictDoNothing().run();
    }
  }
  for (const part of chunk(manifest.reviewLogs)) {
    for (const row of part) {
      tx.insert(reviewLog).values(row).onConflictDoNothing().run();
    }
  }
  for (const row of manifest.appSettings) {
    tx.insert(appSettings)
      .values(row)
      .onConflictDoUpdate({ target: appSettings.key, set: { value: row.value } })
      .run();
  }
}

export function applySqliteSnapshot(db: BetterSQLite3Database, manifest: NativeManifest): void {
  db.transaction((tx) => writeManifest(tx, manifest));
  dropCacheSlot(db, 'presets');
  dropCacheSlot(db, 'decks');
}
