import { afterEach, describe, expect, it, vi } from 'vitest';

// vi.mock runs before the static imports, so the factory loads the state module itself.
vi.mock('#lib/server/study/context.js', async () => {
  const { studyRouteState } = await import('#lib/server/study/test-support/route-support.js');
  return { getStudyContext: () => studyRouteState.deps };
});
import { makeEvent, readBody } from '#lib/server/auth/test-support/route-support.js';
import { SESSION as session } from '#lib/server/domain/test-support/route-support.js';
import type { StudyHarness } from '#lib/server/study/test-support/harness.js';
import { useStudyRouteContext } from '#lib/server/study/test-support/route-support.js';
import { GET, PUT } from './+server';

let h: StudyHarness;
afterEach(async () => {
  await h.close();
});

const read = () => GET(makeEvent('/api/settings/study', { method: 'GET', session }).event);
const write = (body: unknown) =>
  PUT(makeEvent('/api/settings/study', { method: 'PUT', body, session }).event);

describe('/api/settings/study', () => {
  it('gives the defaults, then the stored value', async () => {
    h = await useStudyRouteContext();
    expect(await readBody(await read())).toEqual({
      settings: { rolloverHour: 4, timezone: 'UTC' },
    });
    const settings = { rolloverHour: 4, timezone: 'Europe/Berlin' };
    const response = await write(settings);
    expect(response.status).toBe(200);
    expect(await readBody(response)).toEqual({ settings });
    expect(await readBody(await read())).toEqual({ settings });
  });

  it('refuses a bad body with 400 and keeps the old value', async () => {
    h = await useStudyRouteContext();
    for (const body of [
      { rolloverHour: 24, timezone: 'UTC' },
      { rolloverHour: 3.5, timezone: 'UTC' },
      { rolloverHour: 4, timezone: 'Mars/Base' },
      { rolloverHour: 4, timezone: 'UTC; DROP TABLE card' },
      { rolloverHour: 4, timezone: 'UTC', extra: true },
      { rolloverHour: 4 },
    ]) {
      const response = await write(body);
      expect(response.status).toBe(400);
      expect(await readBody(response)).toEqual({ error: 'bad_request' });
    }
    expect(await readBody(await read())).toEqual({
      settings: { rolloverHour: 4, timezone: 'UTC' },
    });
  });
});
