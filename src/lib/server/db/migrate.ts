import fs from 'node:fs';
import path from 'node:path';
import { migrate as migrateSqlite } from 'drizzle-orm/better-sqlite3/migrator';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import type { Config } from '#lib/server/config.js';
import type { DbHandle } from '#lib/server/db/client.js';

export type MigrationLogger = {
  info: (obj: object, msg?: string) => void;
};

export function migrationsFolder(config: Config, dialect: DbHandle['dialect']): string {
  if (config.migrationsDir !== undefined) {
    return config.migrationsDir;
  }
  return path.resolve(process.cwd(), 'drizzle', dialect === 'sqlite' ? 'sqlite' : 'pg');
}

export async function runMigrations(
  handle: DbHandle,
  config: Config,
  logger: MigrationLogger,
): Promise<void> {
  const folder = migrationsFolder(config, handle.dialect);
  if (!fs.existsSync(folder)) {
    throw new Error(`migrations folder does not exist: ${folder}`);
  }
  if (handle.dialect === 'sqlite') {
    migrateSqlite(handle.db, { migrationsFolder: folder });
  } else {
    await migratePostgres(handle.db, { migrationsFolder: folder });
  }
  logger.info({ dialect: handle.dialect }, 'migrations applied');
}
