export type ApiResult<T> =
  { ok: true; status: number; body: T } | { ok: false; status: number; error: string };

// Reads the stable error code from an error body.
function errorCodeOf(body: unknown): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'string'
  ) {
    return body.error;
  }
  return 'error';
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

// Calls the same-origin JSON API. Adds the CSRF header when a token is known.
export async function apiFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrfToken !== null) {
    headers['x-srep-csrf'] = csrfToken;
  }
  const method = init.method ?? 'GET';
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    return { ok: false, status: 0, error: 'network_error' };
  }
  const parsed: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: errorCodeOf(parsed),
    };
  }
  return { ok: true, status: response.status, body: parsed as T };
}
