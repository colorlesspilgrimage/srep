import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull().$type<JsonValue>(),
});
