// Contract: the saved key-chord store. SQLite and Postgres each have one factory.

import type { KeybindMap } from '#lib/client/tui/keymap.js';
import type { DbHandle } from '#lib/server/db/client.js';
import { createPgKeybindStore } from '#lib/server/settings/keybind-store.pg.js';
import { createSqliteKeybindStore } from '#lib/server/settings/keybind-store.sqlite.js';

export type KeybindSettingsStore = {
  getKeybindValue(): Promise<unknown>;
  putKeybindValue(value: KeybindMap): Promise<void>;
};

export function getKeybindStore(handle: DbHandle): KeybindSettingsStore {
  if (handle.dialect === 'sqlite') {
    return createSqliteKeybindStore(handle.db);
  }
  return createPgKeybindStore(handle.db);
}
