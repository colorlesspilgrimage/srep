import { bigint, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import type { JsonValue } from '#lib/server/db/schema/sqlite.js';

const epochMs = (name: string) => bigint(name, { mode: 'number' });

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull().$type<JsonValue>(),
});

export const authCredential = pgTable('auth_credential', {
  id: text('id').primaryKey(),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: text('public_key').notNull(),
  signCount: bigint('sign_count', { mode: 'number' }).notNull(),
  transports: jsonb('transports').notNull().$type<string[]>(),
  kind: text('kind').notNull().$type<'passkey' | 'security_key'>(),
  nickname: text('nickname').notNull(),
  createdAt: epochMs('created_at').notNull(),
  lastUsedAt: epochMs('last_used_at'),
});

export const authRecovery = pgTable('auth_recovery', {
  id: text('id').primaryKey(),
  codeHash: text('code_hash').notNull(),
  usedAt: epochMs('used_at'),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: epochMs('created_at').notNull(),
  lastSeenAt: epochMs('last_seen_at').notNull(),
  expiresAt: epochMs('expires_at').notNull(),
  userAgent: text('user_agent').notNull(),
});

export const authChallenge = pgTable('auth_challenge', {
  id: text('id').primaryKey(),
  challenge: text('challenge').notNull(),
  purpose: text('purpose').notNull().$type<'setup' | 'register' | 'login'>(),
  expiresAt: epochMs('expires_at').notNull(),
});
