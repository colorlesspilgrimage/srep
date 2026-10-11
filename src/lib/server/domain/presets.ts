import { fail, type Result } from '#lib/server/auth/deps.js';
import { DEFAULT_PRESET_ID } from '#lib/server/domain/builtin.js';
import { presetSchema, type PresetInput } from '#lib/server/domain/core/validation.js';
import type { DomainDeps } from '#lib/server/domain/deps.js';
import { newId } from '#lib/server/domain/ids.js';
import type { PresetRow } from '#lib/server/domain/store/store-types.js';

export async function listPresets(deps: DomainDeps): Promise<Result<{ presets: PresetRow[] }>> {
  return { ok: true, presets: await deps.store.listPresets() };
}

// The routes check the body with presetSchema. This check covers every other caller.
function parsePreset(input: PresetInput): PresetInput | null {
  const parsed = presetSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export async function createPreset(
  deps: DomainDeps,
  input: PresetInput,
): Promise<Result<{ preset: PresetRow }>> {
  const data = parsePreset(input);
  if (data === null) {
    return fail(400, 'bad_request');
  }
  const preset: PresetRow = { id: newId(deps.random), ...data };
  if ((await deps.store.insertPreset(preset)) === 'name_taken') {
    return fail(409, 'name_taken');
  }
  return { ok: true, preset };
}

// A full replace. The default preset can be edited and renamed.
export async function updatePreset(
  deps: DomainDeps,
  id: string,
  input: PresetInput,
): Promise<Result<{ preset: PresetRow }>> {
  const data = parsePreset(input);
  if (data === null) {
    return fail(400, 'bad_request');
  }
  const preset: PresetRow = { id, ...data };
  const result = await deps.store.updatePreset(preset);
  if (result === 'not_found') {
    return fail(404, 'not_found');
  }
  if (result === 'name_taken') {
    return fail(409, 'name_taken');
  }
  return { ok: true, preset };
}

export async function deletePreset(deps: DomainDeps, id: string): Promise<Result<object>> {
  if (id === DEFAULT_PRESET_ID) {
    return fail(409, 'builtin_protected');
  }
  const result = await deps.store.deletePresetUnlessUsed(id);
  if (result === 'not_found') {
    return fail(404, 'not_found');
  }
  if (result === 'in_use') {
    return fail(409, 'in_use');
  }
  return { ok: true };
}
