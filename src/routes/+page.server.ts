import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '#lib/server/db/index.js';
import { privatePageHeaders } from '#lib/server/http/private-page.js';
import { readGallerySettings } from '#lib/server/settings/gallery-settings-read.js';

// Contract: the signed-in home document. Caches must not store it.
// The theme query is null. The gallery page keeps its own query.
// Output: themeId and keybinds. A read failure uses error(status, error).

export const load: PageServerLoad = async ({ setHeaders }) => {
  setHeaders(privatePageHeaders());
  const result = await readGallerySettings(getDb(), null);
  if (!result.ok) {
    error(result.status, result.error);
  }
  return { themeId: result.themeId, keybinds: result.keybinds };
};
