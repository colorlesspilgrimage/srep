import { BUILTIN_NOTE_TYPES, BUILTIN_PRESET } from '#lib/server/domain/builtin.js';
import type { DomainDeps } from '#lib/server/domain/deps.js';
import { purgeTrash } from '#lib/server/domain/notes.js';

// Runs at start. Adds the built-in rows when they are absent and empties old trash.
// A second run changes nothing. It never overwrites a row that the user changed.
export async function seedDomain(deps: DomainDeps): Promise<void> {
  await deps.store.seedDefaults({ preset: BUILTIN_PRESET, noteTypes: BUILTIN_NOTE_TYPES });
  await purgeTrash(deps);
}
