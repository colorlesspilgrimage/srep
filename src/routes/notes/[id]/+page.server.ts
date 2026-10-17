import type { PageServerLoad } from './$types';
import { loadSignedInPage } from '#lib/server/http/signed-in-page.js';

// Contract: the signed-in edit-note document. The shared loader sets no-store.
// This load does not read the note. The page checks the id before GET.

export const load: PageServerLoad = ({ setHeaders }) => loadSignedInPage(setHeaders);
