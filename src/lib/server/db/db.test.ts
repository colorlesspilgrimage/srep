import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { parseConfig } from '#lib/server/config.js';
import { createDb, type DbHandle } from '#lib/server/db/client.js';
import { runMigrations } from '#lib/server/db/migrate.js';
import { appSettings } from '#lib/server/db/schema/sqlite.js';

const logger = { info() {} };
const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srep-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('sqlite database', () => {
  it('creates the file and the parent directory', () => {
    const dir = tempDir();
    const filePath = path.join(dir, 'nested', 'missing', 'app.db');
    const config = parseConfig({ SREP_DATABASE_URL: `sqlite:${filePath}` });
    const handle = createDb(config);
    expect(fs.existsSync(filePath)).toBe(true);
    handle.close();
  });

  it('sets WAL mode for a file database', () => {
    const dir = tempDir();
    const filePath = path.join(dir, 'app.db');
    const config = parseConfig({ SREP_DATABASE_URL: `sqlite:${filePath}` });
    const handle = createDb(config);
    const raw = new Database(filePath, { readonly: true });
    const mode = raw.pragma('journal_mode', { simple: true });
    raw.close();
    expect(mode).toBe('wal');
    handle.close();
  });

  it('applies migrations and keeps data on a second run', async () => {
    const dir = tempDir();
    const filePath = path.join(dir, 'app.db');
    const config = parseConfig({ SREP_DATABASE_URL: `sqlite:${filePath}` });
    const handle = createDb(config);
    await runMigrations(handle, config, logger);
    if (handle.dialect !== 'sqlite') {
      throw new Error('expected sqlite');
    }
    handle.db
      .insert(appSettings)
      .values({ key: 'ui', value: { theme: 'phosphor' } })
      .run();
    await runMigrations(handle, config, logger);
    const rows = handle.db.select().from(appSettings).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toEqual({ theme: 'phosphor' });
    const found = handle.db.select().from(appSettings).where(eq(appSettings.key, 'ui')).get();
    expect(found?.value).toEqual({ theme: 'phosphor' });
    await handle.close();
  });

  it('names a missing migrations folder', async () => {
    const dir = tempDir();
    const missing = path.join(dir, 'no-such-migrations');
    const config = parseConfig({
      SREP_DATABASE_URL: 'sqlite::memory:',
      SREP_MIGRATIONS_DIR: missing,
    });
    const handle = createDb(config);
    await expect(runMigrations(handle, config, logger)).rejects.toThrow(missing);
    await handle.close();
  });

  it('names a migrations folder that has no journal', async () => {
    const empty = tempDir();
    const config = parseConfig({
      SREP_DATABASE_URL: 'sqlite::memory:',
      SREP_MIGRATIONS_DIR: empty,
    });
    const handle = createDb(config);
    await expect(runMigrations(handle, config, logger)).rejects.toThrow(empty);
    await handle.close();
  });

  it('resolves ping and rejects ping after close', async () => {
    const config = parseConfig({ SREP_DATABASE_URL: 'sqlite::memory:' });
    const handle: DbHandle = createDb(config);
    await expect(handle.ping()).resolves.toBeUndefined();
    await handle.close();
    await expect(handle.ping()).rejects.toThrow();
  });
});
