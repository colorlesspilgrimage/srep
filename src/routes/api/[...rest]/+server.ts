import { json, type RequestHandler } from '@sveltejs/kit';

// Signed-in users get 404 here. The hook answers 401 to everyone else first.
const notFound: RequestHandler = () => json({ error: 'not_found' }, { status: 404 });

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
export const HEAD = notFound;
