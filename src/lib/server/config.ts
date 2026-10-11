import path from 'node:path';
import { z } from 'zod';
import { parseRpConfig, type AuthConfig } from '#lib/server/auth/rp-config.js';
import { blankToUnset } from '#lib/server/env.js';
import { once } from '#lib/server/once.js';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const LogLevelSchema = z.enum(LOG_LEVELS);
const MigrateOnStartSchema = z.enum(['true', 'false']);

export type LogLevel = z.infer<typeof LogLevelSchema>;

export type Config = {
  database: { dialect: 'sqlite'; path: string } | { dialect: 'postgres'; url: string };
  logLevel: LogLevel;
  migrationsDir: string | undefined;
  migrateOnStart: boolean;
  auth: AuthConfig;
  media: { dir: string; maxBytes: number };
};

export const DEFAULT_MEDIA_MAX_BYTES = 10 * 1024 * 1024;
const MEDIA_MAX_BYTES_LIMIT = 100 * 1024 * 1024;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function redactDatabaseUrl(url: string): string {
  if (url.startsWith('sqlite:')) {
    return url;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'postgres://invalid';
  }
  const port = parsed.port.length > 0 ? `:${parsed.port}` : '';
  return `postgres://${parsed.hostname}${port}${parsed.pathname}`;
}

function databaseError(url: string): string | undefined {
  if (
    !url.startsWith('sqlite:') &&
    !url.startsWith('postgres://') &&
    !url.startsWith('postgresql://')
  ) {
    return 'SREP_DATABASE_URL: must start with sqlite:, postgres://, or postgresql://';
  }
  if (url.startsWith('sqlite:')) {
    const filePath = url.slice('sqlite:'.length).trim();
    if (filePath.length === 0) {
      return 'SREP_DATABASE_URL: sqlite path must not be empty';
    }
    if (filePath.includes('\0')) {
      return 'SREP_DATABASE_URL: sqlite path must not contain a NUL character';
    }
    return undefined;
  }
  try {
    const parsed = new URL(url);
    if (parsed.hostname.length === 0) {
      return 'SREP_DATABASE_URL: must be a valid postgres URL';
    }
  } catch {
    return 'SREP_DATABASE_URL: must be a valid postgres URL';
  }
  return undefined;
}

// Reads the optional media folder. The default comes later from the database path.
function mediaDirOf(raw: string | undefined, errors: string[]): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw.includes('\0')) {
    errors.push('SREP_MEDIA_DIR: must not contain a NUL character');
    return undefined;
  }
  return path.resolve(raw);
}

function mediaMaxBytesOf(raw: string | undefined, errors: string[]): number {
  if (raw === undefined) {
    return DEFAULT_MEDIA_MAX_BYTES;
  }
  const value = /^[0-9]+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(value >= 1 && value <= MEDIA_MAX_BYTES_LIMIT)) {
    errors.push(`SREP_MEDIA_MAX_BYTES: must be an integer from 1 to ${MEDIA_MAX_BYTES_LIMIT}`);
  }
  return value;
}

// SQLite files keep media next to the database. Other cases use ./data/media.
function defaultMediaDir(database: Config['database']): string {
  if (database.dialect === 'sqlite' && database.path !== ':memory:') {
    return path.join(path.dirname(database.path), 'media');
  }
  return path.resolve('data', 'media');
}

export function parseConfig(env: Record<string, string | undefined>): Config {
  const errors: string[] = [];
  const databaseUrl = blankToUnset(env.SREP_DATABASE_URL) ?? 'sqlite:./data/srep.db';
  const logLevelRaw = blankToUnset(env.SREP_LOG_LEVEL) ?? 'info';
  const migrateRaw = blankToUnset(env.SREP_MIGRATE_ON_START) ?? 'true';
  const migrationsRaw = blankToUnset(env.SREP_MIGRATIONS_DIR);

  const logParsed = LogLevelSchema.safeParse(logLevelRaw);
  if (!logParsed.success) {
    errors.push('SREP_LOG_LEVEL: must be one of fatal, error, warn, info, debug, trace, silent');
  }

  const migrateParsed = MigrateOnStartSchema.safeParse(migrateRaw);
  if (!migrateParsed.success) {
    errors.push('SREP_MIGRATE_ON_START: must be true or false');
  }

  const dbMessage = databaseError(databaseUrl);
  if (dbMessage !== undefined) {
    errors.push(dbMessage);
  }

  let migrationsDir: string | undefined;
  if (migrationsRaw !== undefined) {
    if (migrationsRaw.includes('\0')) {
      errors.push('SREP_MIGRATIONS_DIR: must not contain a NUL character');
    } else {
      migrationsDir = path.resolve(migrationsRaw);
    }
  }

  const mediaDir = mediaDirOf(blankToUnset(env.SREP_MEDIA_DIR), errors);
  const mediaMaxBytes = mediaMaxBytesOf(blankToUnset(env.SREP_MEDIA_MAX_BYTES), errors);

  const authResult = parseRpConfig(env);
  if ('errors' in authResult) {
    errors.push(...authResult.errors);
  }

  if (
    errors.length > 0 ||
    !logParsed.success ||
    !migrateParsed.success ||
    !('value' in authResult)
  ) {
    throw new ConfigError(errors.join('\n'));
  }

  let database: Config['database'];
  if (databaseUrl.startsWith('sqlite:')) {
    const trimmed = databaseUrl.slice('sqlite:'.length).trim();
    database = {
      dialect: 'sqlite',
      path: trimmed === ':memory:' ? trimmed : path.resolve(trimmed),
    };
  } else {
    database = { dialect: 'postgres', url: databaseUrl };
  }

  return {
    database,
    logLevel: logParsed.data,
    migrationsDir,
    migrateOnStart: migrateParsed.data === 'true',
    auth: authResult.value,
    media: { dir: mediaDir ?? defaultMediaDir(database), maxBytes: mediaMaxBytes },
  };
}

export const getConfig = once(() => parseConfig(process.env));
