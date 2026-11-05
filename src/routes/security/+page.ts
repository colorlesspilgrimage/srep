// Contract: /security moves into Settings. Guests still hit the auth redirect first.

import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = () => {
  redirect(303, '/settings?section=security');
};
