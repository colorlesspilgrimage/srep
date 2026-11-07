import { BUILTIN_NOTE_TYPES, BUILTIN_PRESET } from '#lib/server/domain/builtin.js';
import type { DomainDeps } from '#lib/server/domain/deps.js';
import { purgeTrash } from '#lib/server/domain/notes.js';

export async function seedDomain(deps: DomainDeps): Promise<void> {
  await deps.store.seedDefaults({ preset: BUILTIN_PRESET, noteTypes: BUILTIN_NOTE_TYPES });
  await purgeTrash(deps);
}
