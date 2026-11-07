import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '#lib/server/db/index.js';
import { readGallerySettings } from '#lib/server/settings/gallery-settings-read.js';
import { privatePageHeaders } from '#lib/server/http/private-page.js';

export const load: PageServerLoad = async ({ setHeaders, url }) => {
  setHeaders(privatePageHeaders());
  const result = await readGallerySettings(getDb(), url.searchParams.get('theme'));
  if (!result.ok) {
    error(result.status, result.error);
  }
  return { themeId: result.themeId, keybinds: result.keybinds, display: result.display };
};
