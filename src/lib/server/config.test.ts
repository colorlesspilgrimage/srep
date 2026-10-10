import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig, redactDatabaseUrl } from '#lib/server/config.js';

function configErrorMessage(env: Record<string, string | undefined>): string {
  try {
    parseConfig(env);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ConfigError);
    return error instanceof Error ? error.message : '';
  }
  return '';
}

describe('parseConfig', () => {
  it('adds the auth settings', () => {
    expect(parseConfig({}).auth).toEqual({
      origin: 'http://localhost:3000',
      rpId: 'localhost',
      rpName: 'srep',
      secureCookies: false,
    });
    const config = parseConfig({ SREP_ORIGIN: 'https://srep.example.com' });
    expect(config.auth.rpId).toBe('srep.example.com');
  });

  it('throws ConfigError that names SREP_ORIGIN for a bad origin', () => {
    expect(configErrorMessage({ SREP_ORIGIN: 'ftp://x' })).toContain('SREP_ORIGIN');
  });

  it('names both values for an RP ID that does not match', () => {
    const message = configErrorMessage({
      SREP_ORIGIN: 'https://srep.example.com',
      SREP_RP_ID: 'other.org',
    });
    expect(message).toContain('SREP_RP_ID');
    expect(message).toContain('other.org');
    expect(message).toContain('srep.example.com');
  });

  it('reports auth errors together with the other errors', () => {
    const message = configErrorMessage({ SREP_LOG_LEVEL: 'loud', SREP_ORIGIN: 'ftp://x' });
    expect(message).toContain('SREP_LOG_LEVEL');
    expect(message).toContain('SREP_ORIGIN');
  });

  it('uses defaults for an empty env', () => {
    const config = parseConfig({});
    expect(config.logLevel).toBe('info');
    expect(config.migrateOnStart).toBe(true);
    expect(config.migrationsDir).toBeUndefined();
    expect(config.database.dialect).toBe('sqlite');
    if (config.database.dialect !== 'sqlite') {
      return;
    }
    expect(path.isAbsolute(config.database.path)).toBe(true);
    expect(config.database.path.endsWith(`${path.sep}data${path.sep}srep.db`)).toBe(true);
  });

  it('keeps the sqlite memory path', () => {
    const config = parseConfig({ SREP_DATABASE_URL: 'sqlite::memory:' });
    expect(config.database).toEqual({ dialect: 'sqlite', path: ':memory:' });
  });

  it('keeps an absolute sqlite path', () => {
    const config = parseConfig({ SREP_DATABASE_URL: 'sqlite:/tmp/x/y.db' });
    expect(config.database).toEqual({ dialect: 'sqlite', path: '/tmp/x/y.db' });
  });

  it('resolves a relative sqlite path', () => {
    const config = parseConfig({ SREP_DATABASE_URL: 'sqlite:data/srep.db' });
    expect(config.database).toEqual({
      dialect: 'sqlite',
      path: path.resolve(process.cwd(), 'data/srep.db'),
    });
  });

  it('accepts postgres and postgresql URLs', () => {
    expect(parseConfig({ SREP_DATABASE_URL: 'postgres://u:p@h:5432/d' }).database).toEqual({
      dialect: 'postgres',
      url: 'postgres://u:p@h:5432/d',
    });
    expect(parseConfig({ SREP_DATABASE_URL: 'postgresql://u:p@h:5432/d' }).database).toEqual({
      dialect: 'postgres',
      url: 'postgresql://u:p@h:5432/d',
    });
  });

  it('names the bad variable', () => {
    expect(() => parseConfig({ SREP_DATABASE_URL: 'mysql://x' })).toThrow(ConfigError);
    expect(() => parseConfig({ SREP_DATABASE_URL: 'mysql://x' })).toThrow(/SREP_DATABASE_URL/);
    expect(() => parseConfig({ SREP_DATABASE_URL: 'sqlite:' })).toThrow(/SREP_DATABASE_URL/);
    expect(() => parseConfig({ SREP_DATABASE_URL: 'sqlite:a\0b' })).toThrow(/SREP_DATABASE_URL/);
    expect(() => parseConfig({ SREP_LOG_LEVEL: 'loud' })).toThrow(/SREP_LOG_LEVEL/);
    expect(() => parseConfig({ SREP_MIGRATE_ON_START: 'yes' })).toThrow(/SREP_MIGRATE_ON_START/);
    expect(() => parseConfig({ SREP_DATABASE_URL: 'postgres://' })).toThrow(/SREP_DATABASE_URL/);
  });

  it('lists every bad variable', () => {
    const message = configErrorMessage({
      SREP_DATABASE_URL: 'mysql://x',
      SREP_LOG_LEVEL: 'loud',
      SREP_MIGRATE_ON_START: 'yes',
    });
    expect(message).toContain('SREP_DATABASE_URL');
    expect(message).toContain('SREP_LOG_LEVEL');
    expect(message).toContain('SREP_MIGRATE_ON_START');
  });

  it('does not put a password in the error', () => {
    const message = configErrorMessage({
      SREP_DATABASE_URL: 'postgres://u:secret@h/d',
      SREP_LOG_LEVEL: 'loud',
    });
    expect(message).toContain('SREP_LOG_LEVEL');
    expect(message).not.toContain('secret');
  });

  it('treats an empty string as unset', () => {
    const config = parseConfig({
      SREP_DATABASE_URL: '',
      SREP_LOG_LEVEL: '',
      SREP_MIGRATE_ON_START: '',
      SREP_MIGRATIONS_DIR: '',
    });
    expect(config.logLevel).toBe('info');
    expect(config.migrateOnStart).toBe(true);
    expect(config.migrationsDir).toBeUndefined();
    expect(config.database.dialect).toBe('sqlite');
  });
});

describe('redactDatabaseUrl', () => {
  it('drops the user and the password', () => {
    expect(redactDatabaseUrl('postgres://u:secret@h:5432/d')).toBe('postgres://h:5432/d');
  });

  it('returns a sqlite value unchanged', () => {
    expect(redactDatabaseUrl('sqlite:./data/srep.db')).toBe('sqlite:./data/srep.db');
  });
});
