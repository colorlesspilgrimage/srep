import type { PageServerLoad } from './$types';
import { loadSignedInPage } from '#lib/server/http/signed-in-page.js';

// Contract: the signed-in home document. The shared loader sets no-store.

export const load: PageServerLoad = ({ setHeaders }) => loadSignedInPage(setHeaders);
