import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '#lib/server/db/index.js';
import { readGallerySettings } from '#lib/server/settings/gallery-settings-read.js';
import { galleryCacheHeaders } from './cache-headers.js';

// Contract: the signed-in gallery document. Caches must not store it.
// A theme query uses the catalog. An empty query uses the saved theme.
// The page also shows the saved key chords.

export const load: PageServerLoad = async ({ setHeaders, url }) => {
  setHeaders(galleryCacheHeaders());
  const result = await readGallerySettings(getDb(), url.searchParams.get('theme'));
  if (!result.ok) {
    error(result.status, result.error);
  }
  return { themeId: result.themeId, keybinds: result.keybinds };
};
