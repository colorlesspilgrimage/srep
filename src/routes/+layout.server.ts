import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
  authenticated: locals.session !== null,
  csrfToken: locals.session?.csrfToken ?? null,
});
