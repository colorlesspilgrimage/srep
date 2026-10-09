import path from 'node:path';
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const LogLevelSchema = z.enum(LOG_LEVELS);
const MigrateOnStartSchema = z.enum(['true', 'false']);

export type LogLevel = z.infer<typeof LogLevelSchema>;

export type Config = {
  database: { dialect: 'sqlite'; path: string } | { dialect: 'postgres'; url: string };
  logLevel: LogLevel;
  migrationsDir: string | undefined;
  migrateOnStart: boolean;
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function blankToUnset(value: string | undefined): string | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  return value;
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

  if (errors.length > 0 || !logParsed.success || !migrateParsed.success) {
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
  };
}

let cached: Config | undefined;

export function getConfig(): Config {
  if (cached === undefined) {
    cached = parseConfig(process.env);
  }
  return cached;
}
