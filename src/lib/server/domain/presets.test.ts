import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRESET_ID } from '#lib/server/domain/builtin.js';
import { createDeck } from '#lib/server/domain/decks.js';
import {
  createPreset,
  deletePreset,
  listPresets,
  updatePreset,
} from '#lib/server/domain/presets.js';
import {
  createDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';
import { PRESET_INPUT } from '#lib/server/domain/test-support/fixtures.js';

let h: DomainHarness;
afterEach(async () => {
  await h.close();
});

const base = PRESET_INPUT;
const UNKNOWN = '123e4567-e89b-42d3-a456-426614174000';

describe('presets', () => {
  it('creates, lists, replaces and deletes', async () => {
    h = await createDomainHarness();
    const created = await createPreset(h.deps, { ...base, name: 'Fast', newPerDay: 50 });
    if (!created.ok) {
      throw new Error(created.error);
    }
    const listed = await listPresets(h.deps);
    expect(listed.ok && listed.presets.map((p) => p.name)).toEqual(['Default', 'Fast']);
    const id = created.preset.id;
    const replaced = await updatePreset(h.deps, id, {
      ...base,
      name: 'Faster',
      fsrsParams: Array(21).fill(1),
    });
    expect(replaced).toMatchObject({ ok: true, preset: { id, name: 'Faster' } });
    expect(await deletePreset(h.deps, id)).toEqual({ ok: true });
    expect(await deletePreset(h.deps, id)).toMatchObject({ status: 404 });
  });

  it('lets the default preset change but not go away', async () => {
    h = await createDomainHarness();
    expect(await updatePreset(h.deps, DEFAULT_PRESET_ID, { ...base, name: 'Main' })).toMatchObject({
      ok: true,
    });
    expect(await deletePreset(h.deps, DEFAULT_PRESET_ID)).toMatchObject({
      status: 409,
      error: 'builtin_protected',
    });
  });

  it('refuses to delete a preset in use, and refuses duplicates and bad values', async () => {
    h = await createDomainHarness();
    const created = await createPreset(h.deps, { ...base, name: 'Used' });
    if (!created.ok) {
      throw new Error(created.error);
    }
    await createDeck(h.deps, { name: 'D', presetId: created.preset.id });
    expect(await deletePreset(h.deps, created.preset.id)).toMatchObject({
      status: 409,
      error: 'in_use',
    });
    expect(await createPreset(h.deps, { ...base, name: 'Used' })).toMatchObject({
      status: 409,
      error: 'name_taken',
    });
    expect(await updatePreset(h.deps, created.preset.id, { ...base })).toMatchObject({
      error: 'name_taken',
    });
    expect(await updatePreset(h.deps, UNKNOWN, { ...base, name: 'Z' })).toMatchObject({
      status: 404,
    });
    expect(await createPreset(h.deps, { ...base, name: 'Bad', desiredRetention: 1 })).toMatchObject(
      {
        status: 400,
      },
    );
    expect(await updatePreset(h.deps, UNKNOWN, { ...base, maxInterval: 0 })).toMatchObject({
      status: 400,
    });
  });
});
