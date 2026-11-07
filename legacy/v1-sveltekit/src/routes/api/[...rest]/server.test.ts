import { describe, expect, it } from 'vitest';
import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } from './+server';

describe('catch-all API route', () => {
  it.each([
    ['GET', GET],
    ['POST', POST],
    ['PUT', PUT],
    ['PATCH', PATCH],
    ['DELETE', DELETE],
    ['OPTIONS', OPTIONS],
    ['HEAD', HEAD],
  ])('answers %s with 404 and a stable body', async (_method, handler) => {
    const response = await handler({} as never);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('{"error":"not_found"}');
  });
});
