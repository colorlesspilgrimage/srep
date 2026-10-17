// Contract: cache headers for a signed-in response.
// The body is per session, so a cache must not store it (CWE-524, CWE-525).
// privatePageHeaders returns cache-control no-store and vary Cookie.

import { json } from '@sveltejs/kit';

export function privatePageHeaders(): Record<string, string> {
  return { 'cache-control': 'no-store', vary: 'Cookie' };
}

export function privateJson(body: unknown, status = 200): Response {
  return json(body, { status, headers: privatePageHeaders() });
}

// readJson builds its own Response. Copy the private headers onto it.
export function withPrivateHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(privatePageHeaders())) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}
