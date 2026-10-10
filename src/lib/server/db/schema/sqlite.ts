import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull().$type<JsonValue>(),
});

export const authCredential = sqliteTable('auth_credential', {
  id: text('id').primaryKey(),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: text('public_key').notNull(),
  signCount: integer('sign_count').notNull(),
  transports: text('transports', { mode: 'json' }).notNull().$type<string[]>(),
  kind: text('kind').notNull().$type<'passkey' | 'security_key'>(),
  nickname: text('nickname').notNull(),
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at'),
});

export const authRecovery = sqliteTable('auth_recovery', {
  id: text('id').primaryKey(),
  codeHash: text('code_hash').notNull(),
  usedAt: integer('used_at'),
});

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: integer('created_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  userAgent: text('user_agent').notNull(),
});

export const authChallenge = sqliteTable('auth_challenge', {
  id: text('id').primaryKey(),
  challenge: text('challenge').notNull(),
  purpose: text('purpose').notNull().$type<'setup' | 'register' | 'login'>(),
  expiresAt: integer('expires_at').notNull(),
});
