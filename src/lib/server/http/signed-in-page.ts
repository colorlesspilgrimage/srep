// Contract: load theme and keybinds for a signed-in page.
// The theme query is null. The gallery page keeps its own query.
// Caches must not store the document. A read failure uses error(status, error).

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
  return { themeId: result.themeId, keybinds: result.keybinds };
}
