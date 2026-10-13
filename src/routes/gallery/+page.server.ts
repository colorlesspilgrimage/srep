import type { PageServerLoad } from './$types';
import { themeIdFromQuery } from '../../lib/client/tui/themes.js';
import { galleryCacheHeaders } from './cache-headers.js';

// Contract: the signed-in gallery document. Caches must not store it.
// The theme query must match a catalog id.

export const load: PageServerLoad = ({ setHeaders, url }) => {
  setHeaders(galleryCacheHeaders());
  return { themeId: themeIdFromQuery(url.searchParams.get('theme')) };
};
