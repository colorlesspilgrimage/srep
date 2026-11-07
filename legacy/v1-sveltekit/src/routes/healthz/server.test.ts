import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ping, errorLog } = vi.hoisted(() => ({
  ping: vi.fn(),
  errorLog: vi.fn(),
}));

vi.mock('#lib/server/db/index.js', () => ({
  getDb: () => ({ ping }),
}));

vi.mock('#lib/server/logger.js', () => ({
  getLogger: () => ({ error: errorLog }),
}));

import { GET } from './+server';

describe('GET /healthz', () => {
  beforeEach(() => {
    ping.mockReset();
    errorLog.mockReset();
  });

  it('returns ok and no-store', async () => {
    ping.mockResolvedValue(undefined);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('returns 503 when ping fails', async () => {
    ping.mockRejectedValue(new Error('database secret is down'));
    const response = await GET();
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toBe('{"status":"error"}');
    expect(text).not.toContain('secret');
  });
});
