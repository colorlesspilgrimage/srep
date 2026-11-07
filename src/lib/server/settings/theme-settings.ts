import { z } from 'zod';
import { fail, type Result } from '#lib/server/auth/deps.js';
import { DEFAULT_THEME_ID, migrateThemeId, themeById } from '#lib/client/tui/themes.js';
import type { ThemeSettingsStore } from '#lib/server/settings/theme-store.js';

export const themeSettingsSchema = z.object({ id: z.string() }).strict();

export type ThemeSettingsLogger = {
  error: (obj: { key: 'theme' }, msg?: string) => void;
};

export async function putThemeSettings(
  store: ThemeSettingsStore,
  id: string,
): Promise<Result<{ id: string }>> {
  if (themeById(id) === undefined) {
    return fail(400, 'bad_request');
  }
  await store.putThemeValue({ id });
  return { ok: true, id };
}

export function interpretTheme(
  stored: unknown,
  logger: ThemeSettingsLogger,
): Result<{ id: string }> {
  if (stored === undefined) {
    return { ok: true, id: DEFAULT_THEME_ID };
  }
  const parsed = themeSettingsSchema.safeParse(stored);
  if (!parsed.success) {
    logger.error({ key: 'theme' });
    return fail(500, 'settings_corrupt');
  }
  const id = migrateThemeId(parsed.data.id);
  if (id === null || themeById(id) === undefined) {
    logger.error({ key: 'theme' });
    return fail(500, 'settings_corrupt');
  }
  return { ok: true, id };
}

export async function getThemeSettings(
  store: ThemeSettingsStore,
  logger: ThemeSettingsLogger,
): Promise<Result<{ id: string }>> {
  return interpretTheme(await store.getThemeValue(), logger);
}
