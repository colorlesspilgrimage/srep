import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/domain/context.js', async () => {
  const { domainRouteState } = await import('#lib/server/domain/test-support/route-support.js');
  return { getDomainContext: () => domainRouteState.deps };
});
import { makeEvent, readBody } from '#lib/server/auth/test-support/route-support.js';
import { DEFAULT_PRESET_ID } from '#lib/server/domain/builtin.js';
import type { PresetRow } from '#lib/server/domain/store/store-types.js';
import type { DomainHarness } from '#lib/server/domain/test-support/harness.js';
import {
  SESSION as session,
  UNKNOWN_ID,
  useDomainRouteContext,
} from '#lib/server/domain/test-support/route-support.js';
import { GET as list, POST as create } from './+server';
import { DELETE as remove, PUT as put } from './[id]/+server';
import { PRESET_INPUT } from '#lib/server/domain/test-support/fixtures.js';

let h: DomainHarness;
afterEach(async () => {
  await h.close();
});

const base = PRESET_INPUT;
const at = (id: string, method: string, body?: unknown) =>
  makeEvent(`/api/presets/${id}`, { method, body, params: { id }, session }).event;

describe('preset routes', () => {
  it('creates, lists, replaces and deletes a preset', async () => {
    h = await useDomainRouteContext();
    const created = await create(
      makeEvent('/api/presets', { body: { ...base, name: 'Fast' }, session }).event,
    );
    expect(created.status).toBe(201);
    const { preset } = await readBody<{ preset: PresetRow }>(created);
    const listed = await readBody<{ presets: PresetRow[] }>(
      await list(makeEvent('/api/presets', { method: 'GET', session }).event),
    );
    expect(listed.presets.map((p) => p.name)).toEqual(['Default', 'Fast']);
    const replaced = await put(at(preset.id, 'PUT', { ...base, name: 'Slow', newPerDay: 1 }));
    expect(await readBody(replaced)).toEqual({ preset: { ...preset, name: 'Slow', newPerDay: 1 } });
    expect(await readBody(await remove(at(preset.id, 'DELETE')))).toEqual({ ok: true });
  });

  it('protects the default preset and refuses bad input', async () => {
    h = await useDomainRouteContext();
    const protectedDelete = await remove(at(DEFAULT_PRESET_ID, 'DELETE'));
    expect(protectedDelete.status).toBe(409);
    expect(await readBody(protectedDelete)).toEqual({ error: 'builtin_protected' });
    const bad = await create(
      makeEvent('/api/presets', { body: { ...base, desiredRetention: 2 }, session }).event,
    );
    expect(bad.status).toBe(400);
    expect(await readBody(bad)).toEqual({ error: 'bad_request' });
    expect((await put(at('nope', 'PUT', base))).status).toBe(400);
    expect((await remove(at('nope', 'DELETE'))).status).toBe(400);
    expect((await put(at(UNKNOWN_ID, 'PUT', { ...base, extra: 1 }))).status).toBe(400);
    expect((await put(at(UNKNOWN_ID, 'PUT', { ...base, name: 'Z' }))).status).toBe(404);
  });
});
