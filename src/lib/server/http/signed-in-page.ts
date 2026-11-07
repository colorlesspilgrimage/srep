import { error } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { readGallerySettings } from '#lib/server/settings/gallery-settings-read.js';
import { privatePageHeaders } from './private-page.js';

export async function loadSignedInPage(setHeaders: (headers: Record<string, string>) => void) {
  setHeaders(privatePageHeaders());
  const result = await readGallerySettings(getDb(), null);
  if (!result.ok) {
    error(result.status, result.error);
  }
  return { themeId: result.themeId, keybinds: result.keybinds, display: result.display };
}
