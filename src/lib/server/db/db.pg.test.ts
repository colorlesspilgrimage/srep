import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { parseConfig, type Config } from '#lib/server/config.js';
import { createDb, type DbHandle } from '#lib/server/db/client.js';
import { runMigrations } from '#lib/server/db/migrate.js';
import { defineStoreSuite } from '#lib/server/auth/store.suite.js';
import { createPgHarness } from '#lib/server/auth/test-support/harness.js';
import { defineDomainStoreSuite } from '#lib/server/domain/store/store.suite.js';
import { createPgDomainHarness } from '#lib/server/domain/test-support/harness.js';
import { appSettings } from '#lib/server/db/schema/pg.js';
import { defineStudyStoreSuite } from '#lib/server/study/store/study-store.suite.js';
import { createPgStudyHarness } from '#lib/server/study/test-support/harness.js';

const logger = { info() {} };
const url = process.env.SREP_TEST_POSTGRES_URL;

describe.skipIf(!url)('postgres database', () => {
  let handle: DbHandle;
  let config: Config;

  afterAll(async () => {
    if (handle === undefined) {
      return;
    }
    if (handle.dialect === 'postgres') {
      await handle.db.execute(
        sql`drop table if exists app_settings, auth_credential, auth_recovery, session, auth_challenge, deck_preset, deck, note_type, card_template, note, note_tag, card, review_log, media cascade`,
      );
      await handle.db.execute(sql`drop schema if exists drizzle cascade`);
    }
    await handle.close();
  });

  it('applies migrations and reads a JSON value', async () => {
    config = parseConfig({ SREP_DATABASE_URL: url });
    handle = createDb(config);
    await runMigrations(handle, config, logger);
    await runMigrations(handle, config, logger);
    if (handle.dialect !== 'postgres') {
      throw new Error('expected postgres');
    }
    await handle.db.insert(appSettings).values({ key: 'ui', value: { theme: 'phosphor' } });
    const rows = await handle.db.select().from(appSettings);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toEqual({ theme: 'phosphor' });
    await handle.db.delete(appSettings);
  });

  it('names a missing migrations folder', async () => {
    const missing = '/tmp/srep-missing-pg-migrations';
    const bad = parseConfig({
      SREP_DATABASE_URL: url,
      SREP_MIGRATIONS_DIR: missing,
    });
    const local = createDb(bad);
    await expect(runMigrations(local, bad, logger)).rejects.toThrow(missing);
    await local.close();
  });

  it('resolves ping', async () => {
    await expect(handle.ping()).resolves.toBeUndefined();
  });

  // The store suites run here, so they cannot race with the cleanup above.
  describe('auth store (postgres)', () => {
    defineStoreSuite(() => createPgHarness(url ?? ''));
  });

  describe('domain store (postgres)', () => {
    defineDomainStoreSuite(() => createPgDomainHarness(url ?? ''));
  });

  describe('study store (postgres)', () => {
    defineStudyStoreSuite(() => createPgStudyHarness(url ?? ''));
  });
});
