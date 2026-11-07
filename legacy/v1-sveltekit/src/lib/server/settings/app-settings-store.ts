import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { appSettings as pgAppSettings } from '#lib/server/db/schema/pg.js';
import { appSettings as sqliteAppSettings, type JsonValue } from '#lib/server/db/schema/sqlite.js';
import { dropCacheSlot, readCached, type CacheSlot } from '#lib/server/read-cache.js';

export type AppSettingsSlotConfig<Value> = {
  key: string;
  cacheSlot: CacheSlot;
  normalize?: (value: Value) => unknown;
  absentValue?: unknown;
};

export type AppSettingsSlot = {
  getValue(): Promise<unknown>;
  putValue(value: unknown): Promise<void>;
};

export function createPgAppSettingsSlot<Value>(
  db: PostgresJsDatabase,
  config: AppSettingsSlotConfig<Value>,
): AppSettingsSlot {
  const { key, cacheSlot, normalize, absentValue } = config;
  return {
    async getValue() {
      return readCached(db, cacheSlot, async () => {
        const [row] = await db
          .select({ value: pgAppSettings.value })
          .from(pgAppSettings)
          .where(eq(pgAppSettings.key, key));
        if (row === undefined) {
          return absentValue;
        }
        return row.value;
      });
    },

    async putValue(value) {
      const stored = (normalize !== undefined ? normalize(value as Value) : value) as JsonValue;
      await db
        .insert(pgAppSettings)
        .values({ key, value: stored })
        .onConflictDoUpdate({ target: pgAppSettings.key, set: { value: stored } });
      dropCacheSlot(db, cacheSlot);
    },
  };
}

export function createSqliteAppSettingsSlot<Value>(
  db: BetterSQLite3Database,
  config: AppSettingsSlotConfig<Value>,
): AppSettingsSlot {
  const { key, cacheSlot, normalize, absentValue } = config;
  return {
    async getValue() {
      return readCached(db, cacheSlot, async () => {
        const row = db
          .select({ value: sqliteAppSettings.value })
          .from(sqliteAppSettings)
          .where(eq(sqliteAppSettings.key, key))
          .get();
        if (row === undefined) {
          return absentValue;
        }
        return row.value;
      });
    },

    async putValue(value) {
      const stored = (normalize !== undefined ? normalize(value as Value) : value) as JsonValue;
      db.insert(sqliteAppSettings)
        .values({ key, value: stored })
        .onConflictDoUpdate({ target: sqliteAppSettings.key, set: { value: stored } })
        .run();
      dropCacheSlot(db, cacheSlot);
    },
  };
}
