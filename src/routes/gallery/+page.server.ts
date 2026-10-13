import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '#lib/server/db/index.js';
import { getLogger } from '#lib/server/logger.js';
import { getThemeSettings } from '#lib/server/settings/theme-settings.js';
import { getThemeStore } from '#lib/server/settings/theme-store.js';
import { themeIdFromQuery } from '../../lib/client/tui/themes.js';
import { galleryCacheHeaders } from './cache-headers.js';

// Contract: the signed-in gallery document. Caches must not store it.
// A theme query uses the catalog. An empty query uses the saved theme.

export const load: PageServerLoad = async ({ setHeaders, url }) => {
  setHeaders(galleryCacheHeaders());
  const query = url.searchParams.get('theme');
  if (query !== null) {
    return { themeId: themeIdFromQuery(query) };
  }
  const result = await getThemeSettings(getThemeStore(getDb()), getLogger());
  if (!result.ok) {
    error(result.status, result.error);
  }
  return { themeId: result.id };
};
