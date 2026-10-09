import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Config } from '#lib/server/config.js';

export type DbHandle =
  | {
      dialect: 'sqlite';
      db: BetterSQLite3Database;
      ping: () => Promise<void>;
      close: () => Promise<void>;
    }
  | {
      dialect: 'postgres';
      db: PostgresJsDatabase;
      ping: () => Promise<void>;
      close: () => Promise<void>;
    };

export function createDb(config: Config): DbHandle {
  if (config.database.dialect === 'sqlite') {
    const filePath = config.database.path;
    if (filePath !== ':memory:') {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    const sqlite = new Database(filePath);
    if (filePath !== ':memory:') {
      sqlite.pragma('journal_mode = WAL');
    }
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    const db = drizzleSqlite(sqlite);
    return {
      dialect: 'sqlite',
      db,
      async ping() {
        sqlite.prepare('select 1').get();
      },
      async close() {
        sqlite.close();
      },
    };
  }

  const sql = postgres(config.database.url, { max: 5, onnotice: () => {} });
  const db = drizzlePostgres(sql);
  return {
    dialect: 'postgres',
    db,
    async ping() {
      await sql`select 1`;
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
