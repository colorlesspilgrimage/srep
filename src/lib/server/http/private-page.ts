import { json } from '@sveltejs/kit';

export function privatePageHeaders(): Record<string, string> {
  return { 'cache-control': 'no-store', vary: 'Cookie' };
}

export function privateJson(body: unknown, status = 200): Response {
  return json(body, { status, headers: privatePageHeaders() });
}

export function withPrivateHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(privatePageHeaders())) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}
