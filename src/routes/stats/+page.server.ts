import type { PageServerLoad } from './$types';
import { loadSignedInPage } from '#lib/server/http/signed-in-page.js';

export const load: PageServerLoad = ({ setHeaders }) => loadSignedInPage(setHeaders);
