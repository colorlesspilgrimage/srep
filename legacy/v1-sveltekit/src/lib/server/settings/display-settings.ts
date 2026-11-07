import { z } from 'zod';
import {
  DEFAULT_DISPLAY,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  copyDisplayPrefs,
  type DisplayPrefs,
} from '#lib/client/app/display-prefs.js';
import { fail, type Result } from '#lib/server/auth/deps.js';
import type { DisplaySettingsStore } from '#lib/server/settings/display-store.js';

export const displaySettingsSchema = z
  .object({
    fontSize: z.number().int().min(MIN_FONT_SIZE).max(MAX_FONT_SIZE),
    reducedMotion: z.boolean(),
    scanline: z.boolean(),
    cursorBlink: z.boolean(),
  })
  .strict();

export type DisplaySettingsLogger = {
  error: (obj: { key: 'display' }, msg?: string) => void;
};

export async function putDisplaySettings(
  store: DisplaySettingsStore,
  display: DisplayPrefs,
): Promise<Result<{ display: DisplayPrefs }>> {
  const parsed = displaySettingsSchema.safeParse(display);
  if (!parsed.success) {
    return fail(400, 'bad_request');
  }
  await store.putDisplayValue(parsed.data);
  return { ok: true, display: copyDisplayPrefs(parsed.data) };
}

export function interpretDisplay(
  stored: unknown,
  logger: DisplaySettingsLogger,
): Result<{ display: DisplayPrefs }> {
  if (stored === undefined) {
    return { ok: true, display: copyDisplayPrefs(DEFAULT_DISPLAY) };
  }
  const parsed = displaySettingsSchema.safeParse(stored);
  if (!parsed.success) {
    logger.error({ key: 'display' });
    return fail(500, 'settings_corrupt');
  }
  return { ok: true, display: copyDisplayPrefs(parsed.data) };
}

export async function getDisplaySettings(
  store: DisplaySettingsStore,
  logger: DisplaySettingsLogger,
): Promise<Result<{ display: DisplayPrefs }>> {
  return interpretDisplay(await store.getDisplayValue(), logger);
}
