import fs from 'node:fs/promises';
import path from 'node:path';
import { packNativeArchive, unpackNativeArchive } from '#lib/server/import-export/zip-archive.js';
import type { Config } from '#lib/server/config.js';
import { sql } from 'drizzle-orm';
import { runMigrations } from '#lib/server/db/migrate.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createDb, type DbHandle } from '#lib/server/db/client.js';
import { DOMAIN_TABLES } from '#lib/server/domain/test-support/harness.js';
import { referencedMediaShas } from '#lib/server/import-export/collect-media.js';
import { createFsMediaFiles } from '#lib/server/domain/media-files.fs.js';
import { readSqliteSnapshot } from '#lib/server/import-export/snapshot-read.sqlite.js';
import { applySqliteSnapshot } from '#lib/server/import-export/snapshot-write.sqlite.js';

export async function backupSqlite(config: Config, outPath: string, now: number): Promise<void> {
  if (config.database.dialect !== 'sqlite' || config.database.path === ':memory:') {
    throw new Error('backup requires a sqlite file database');
  }
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const db = createDb(config);
  try {
    if (db.dialect !== 'sqlite') {
      throw new Error('backup requires sqlite');
    }
    const manifest = readSqliteSnapshot(db.db as BetterSQLite3Database, now);
    const media = createFsMediaFiles(config.media.dir);
    const files = new Map<string, Buffer>();
    for (const sha of referencedMediaShas(manifest)) {
      const bytes = await media.read(sha);
      if (bytes !== null) {
        files.set(sha, bytes);
      }
    }
    const archive = packNativeArchive(manifest, files);
    await fs.writeFile(outPath, archive, { mode: 0o600 });
  } finally {
    await db.close();
  }
}

export async function restoreSqlite(config: Config, fromPath: string): Promise<void> {
  if (config.database.dialect !== 'sqlite' || config.database.path === ':memory:') {
    throw new Error('restore requires a sqlite file database');
  }
  const bytes = await fs.readFile(fromPath);
  const { manifest, files } = unpackNativeArchive(bytes);
  const media = createFsMediaFiles(config.media.dir);
  await fs.mkdir(config.media.dir, { recursive: true, mode: 0o700 });
  let db: DbHandle | undefined;
  try {
    db = createDb(config);
    await runMigrations(db, config, { info: () => undefined });
    if (db.dialect !== 'sqlite') {
      throw new Error('restore requires sqlite');
    }
    const sqlite = db.db as BetterSQLite3Database;
    for (const table of [...DOMAIN_TABLES].reverse()) {
      sqlite.run(sql.raw(`delete from ${table}`));
    }
    applySqliteSnapshot(sqlite, manifest);
    for (const sha of referencedMediaShas(manifest)) {
      const body = files.get(sha);
      if (body !== undefined) {
        await media.write(sha, body);
      }
    }
  } finally {
    await db?.close().catch(() => undefined);
  }
}
