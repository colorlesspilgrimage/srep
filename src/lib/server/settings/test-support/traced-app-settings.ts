import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export type TracedAppSettingsDb = {
  sqlite: Database.Database;
  sqls: string[];
  db: BetterSQLite3Database;
};

export function openTracedAppSettings(): TracedAppSettingsDb {
  const sqlite = new Database(':memory:');
  const sqls: string[] = [];
  const prepare = sqlite.prepare.bind(sqlite);
  sqlite.prepare = ((sql: string) => {
    sqls.push(sql);
    return prepare(sql);
  }) as typeof sqlite.prepare;
  sqlite.exec('create table app_settings (key text primary key, value text not null)');
  const db = drizzle(sqlite);
  return { sqlite, sqls, db };
}
