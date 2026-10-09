import { describe, expect, it, vi } from 'vitest';
import { checkHealth } from '#lib/server/health.js';

describe('checkHealth', () => {
  it('returns ok when ping resolves', async () => {
    const logger = { error: vi.fn() };
    await expect(checkHealth(async () => undefined, logger)).resolves.toEqual({
      status: 200,
      body: { status: 'ok' },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('returns error when ping rejects and hides the error text', async () => {
    const logger = { error: vi.fn() };
    const result = await checkHealth(async () => {
      throw new Error('database password secret is down');
    }, logger);
    expect(result).toEqual({ status: 503, body: { status: 'error' } });
    expect(JSON.stringify(result.body)).not.toContain('secret');
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
