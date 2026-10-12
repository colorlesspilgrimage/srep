import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { execSql } from '#lib/server/domain/store/suite-support.js';
import { getSettings, updateSettings } from '#lib/server/study/study-settings.js';
import { createStudyHarness, type StudyHarness } from '#lib/server/study/test-support/harness.js';

let h: StudyHarness;
afterEach(async () => {
  await h.close();
});

describe('study settings', () => {
  it('gives the defaults when nothing is stored', async () => {
    h = await createStudyHarness();
    expect(await getSettings(h.study)).toEqual({
      ok: true,
      settings: { rolloverHour: 4, timezone: 'UTC' },
    });
  });

  it('stores and reads the settings', async () => {
    h = await createStudyHarness();
    const settings = { rolloverHour: 0, timezone: 'Europe/Berlin' };
    expect(await updateSettings(h.study, settings)).toEqual({ ok: true, settings });
    expect(await getSettings(h.study)).toEqual({ ok: true, settings });
  });

  it('reports a stored value that is not valid as 500 and logs it', async () => {
    h = await createStudyHarness();
    await execSql(
      h,
      sql`insert into app_settings (key, value) values ('study', '{"rolloverHour":99}')`,
    );
    expect(await getSettings(h.study)).toEqual({
      ok: false,
      status: 500,
      error: 'settings_corrupt',
    });
    expect(h.errors).toHaveLength(1);
  });
});
