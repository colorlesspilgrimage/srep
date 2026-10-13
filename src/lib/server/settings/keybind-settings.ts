// Contract: read and replace the saved key chords.
// A bad map is 400 and does not write. A bad stored value is 500 (CWE-20).

import { z } from 'zod';
import {
  DEFAULT_KEYBINDS,
  PALETTE_CLOSE,
  PALETTE_OPEN,
  PALETTE_OPEN_COLON,
  canonicalizeChord,
  type ActionId,
  type KeybindMap,
} from '#lib/client/tui/keymap.js';
import { fail, type Result } from '#lib/server/auth/deps.js';
import type { KeybindSettingsStore } from '#lib/server/settings/keybind-store.js';

export const keybindSettingsSchema = z
  .object({
    [PALETTE_OPEN]: z.string(),
    [PALETTE_OPEN_COLON]: z.string(),
    [PALETTE_CLOSE]: z.string(),
  })
  .strict();

export type KeybindSettingsLogger = {
  error: (obj: { key: 'keybinds' }, msg?: string) => void;
};

function copyDefault(): KeybindMap {
  return {
    [PALETTE_OPEN]: DEFAULT_KEYBINDS[PALETTE_OPEN],
    [PALETTE_OPEN_COLON]: DEFAULT_KEYBINDS[PALETTE_OPEN_COLON],
    [PALETTE_CLOSE]: DEFAULT_KEYBINDS[PALETTE_CLOSE],
  };
}

function canonicalMap(input: Record<ActionId, string>): KeybindMap {
  return {
    [PALETTE_OPEN]: canonicalizeChord(input[PALETTE_OPEN]),
    [PALETTE_OPEN_COLON]: canonicalizeChord(input[PALETTE_OPEN_COLON]),
    [PALETTE_CLOSE]: canonicalizeChord(input[PALETTE_CLOSE]),
  };
}

function chordsConflict(map: KeybindMap): boolean {
  const values = [map[PALETTE_OPEN], map[PALETTE_OPEN_COLON], map[PALETTE_CLOSE]];
  return new Set(values).size !== values.length;
}

function isBadChord(error: unknown): boolean {
  return error instanceof Error && error.message === 'bad_chord';
}

function logCorrupt(logger: KeybindSettingsLogger): Result<{ keybinds: KeybindMap }> {
  logger.error({ key: 'keybinds' });
  return fail(500, 'settings_corrupt');
}

export function interpretKeybinds(
  stored: unknown,
  logger: KeybindSettingsLogger,
): Result<{ keybinds: KeybindMap }> {
  if (stored === undefined || stored === null) {
    return { ok: true, keybinds: copyDefault() };
  }
  const parsed = keybindSettingsSchema.safeParse(stored);
  if (!parsed.success) {
    return logCorrupt(logger);
  }
  try {
    const keybinds = canonicalMap(parsed.data);
    if (chordsConflict(keybinds)) {
      return logCorrupt(logger);
    }
    return { ok: true, keybinds };
  } catch (error) {
    if (isBadChord(error)) {
      return logCorrupt(logger);
    }
    throw error;
  }
}

export async function getKeybindSettings(
  store: KeybindSettingsStore,
  logger: KeybindSettingsLogger,
): Promise<Result<{ keybinds: KeybindMap }>> {
  return interpretKeybinds(await store.getKeybindValue(), logger);
}

export async function putKeybindSettings(
  store: KeybindSettingsStore,
  input: unknown,
): Promise<Result<{ keybinds: KeybindMap }>> {
  const parsed = keybindSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return fail(400, 'bad_request');
  }
  let keybinds: KeybindMap;
  try {
    keybinds = canonicalMap(parsed.data);
  } catch (error) {
    if (isBadChord(error)) {
      return fail(400, 'bad_request');
    }
    throw error;
  }
  if (chordsConflict(keybinds)) {
    return fail(400, 'bad_request');
  }
  await store.putKeybindValue(keybinds);
  return { ok: true, keybinds };
}
