import type { PageServerLoad } from './$types';
import { loadSignedInPage } from '#lib/server/http/signed-in-page.js';

// Contract: the signed-in add-note document. The shared loader sets no-store.
// The deck query is read in the page. This load does not read a note.

export const load: PageServerLoad = ({ setHeaders }) => loadSignedInPage(setHeaders);
