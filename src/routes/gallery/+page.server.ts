import type { PageServerLoad } from './$types';
import { galleryCacheHeaders } from './cache-headers.js';

// Contract: the signed-in gallery document. Caches must not store it.

export const load: PageServerLoad = ({ setHeaders }) => {
  setHeaders(galleryCacheHeaders());
  return {};
};
