import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import type { JsonValue } from '#lib/server/db/schema/sqlite.js';

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull().$type<JsonValue>(),
});
