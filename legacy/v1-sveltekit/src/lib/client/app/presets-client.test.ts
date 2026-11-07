import { describe, expect, it } from 'vitest';
import type { ApiResult } from '#lib/client/api.js';
import { BLANK_PRESET_DRAFT } from './preset-form.js';
import { createPresetsClient } from './presets-client.js';

function calls() {
  const seen: { path: string; init?: { method?: string; body?: unknown } }[] = [];
  const fetchJson = async <T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<ApiResult<T>> => {
    seen.push({ path, init });
    return { ok: true, status: 200, body: {} as T };
  };
  return { seen, fetchJson };
}

const draft = { ...BLANK_PRESET_DRAFT, name: 'Fast' };
const id = '00000000-0000-4000-8000-000000000099';

describe('createPresetsClient', () => {
  it('does not fetch a bad draft or id', async () => {
    const { seen, fetchJson } = calls();
    const client = createPresetsClient(fetchJson);
    expect(await client.createPreset({ ...draft, name: '' })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await client.updatePreset('nope', draft)).toMatchObject({ ok: false, status: 400 });
    expect(await client.deletePreset('<script>')).toMatchObject({ ok: false, status: 400 });
    expect(seen).toEqual([]);
  });

  it('sends list, create, update, and delete calls', async () => {
    const { seen, fetchJson } = calls();
    const client = createPresetsClient(fetchJson);
    await client.listPresets();
    await client.createPreset(draft);
    await client.updatePreset(id, draft);
    await client.deletePreset(id);
    expect(seen).toEqual([
      { path: '/api/presets', init: undefined },
      {
        path: '/api/presets',
        init: {
          method: 'POST',
          body: {
            name: 'Fast',
            newPerDay: 20,
            reviewsPerDay: 200,
            desiredRetention: 0.9,
            learningSteps: [1, 10],
            relearningSteps: [10],
            maxInterval: 36_500,
            fsrsParams: null,
            burySiblings: false,
            newOrder: 'added',
          },
        },
      },
      {
        path: `/api/presets/${id}`,
        init: {
          method: 'PUT',
          body: {
            name: 'Fast',
            newPerDay: 20,
            reviewsPerDay: 200,
            desiredRetention: 0.9,
            learningSteps: [1, 10],
            relearningSteps: [10],
            maxInterval: 36_500,
            fsrsParams: null,
            burySiblings: false,
            newOrder: 'added',
          },
        },
      },
      { path: `/api/presets/${id}`, init: { method: 'DELETE' } },
    ]);
  });
});
