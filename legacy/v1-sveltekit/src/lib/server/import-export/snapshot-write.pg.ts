import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
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
} from '#lib/server/db/schema/pg.js';
import type { NativeManifest } from '#lib/server/import-export/types.js';
import { dropCacheSlot } from '#lib/server/read-cache.js';

type Exec = Pick<PostgresJsDatabase, 'select' | 'insert' | 'update' | 'delete'>;

function presetValues(row: NativeManifest['presets'][number]) {
  return { ...row, fsrsParams: row.fsrsParams ?? sql`'null'::jsonb` };
}

async function writeManifest(tx: Exec, manifest: NativeManifest): Promise<void> {
  for (const row of manifest.presets) {
    await tx.insert(deckPreset).values(presetValues(row)).onConflictDoNothing();
  }
  for (const row of manifest.decks) {
    await tx.insert(deck).values(row).onConflictDoNothing();
  }
  for (const { noteType: row, templates } of manifest.noteTypes) {
    await tx.insert(noteType).values(row).onConflictDoNothing();
    for (const template of templates) {
      await tx.insert(cardTemplate).values(template).onConflictDoNothing();
    }
  }
  for (const row of manifest.media) {
    await tx.insert(media).values(row).onConflictDoNothing({ target: media.sha256 });
  }
  for (const part of chunk(manifest.notes)) {
    for (const row of part) {
      await tx.insert(note).values(row).onConflictDoNothing();
    }
  }
  for (const part of chunk(manifest.noteTags)) {
    for (const row of part) {
      await tx.insert(noteTag).values(row).onConflictDoNothing();
    }
  }
  for (const part of chunk(manifest.cards)) {
    for (const row of part) {
      await tx.insert(card).values(row).onConflictDoNothing();
    }
  }
  for (const part of chunk(manifest.reviewLogs)) {
    for (const row of part) {
      await tx.insert(reviewLog).values(row).onConflictDoNothing();
    }
  }
  for (const row of manifest.appSettings) {
    await tx
      .insert(appSettings)
      .values(row)
      .onConflictDoUpdate({ target: appSettings.key, set: { value: row.value } });
  }
}

export async function applyPgSnapshot(
  db: PostgresJsDatabase,
  manifest: NativeManifest,
): Promise<void> {
  await db.transaction(async (tx) => writeManifest(tx, manifest));
  dropCacheSlot(db, 'presets');
  dropCacheSlot(db, 'decks');
}
