import { describe, expect, it } from 'vitest';
import { parseRpConfig } from '#lib/server/auth/rp-config.js';

function ok(env: Record<string, string>) {
  const result = parseRpConfig(env);
  if ('errors' in result) {
    throw new Error(result.errors.join('|'));
  }
  return result.value;
}

function errors(env: Record<string, string>): string[] {
  const result = parseRpConfig(env);
  return 'errors' in result ? result.errors : [];
}

describe('parseRpConfig', () => {
  it('uses localhost defaults', () => {
    expect(ok({})).toEqual({
      origin: 'http://localhost:3000',
      rpId: 'localhost',
      rpName: 'srep',
      secureCookies: false,
    });
  });

  it('accepts https and derives the RP ID', () => {
    const value = ok({ SREP_ORIGIN: 'https://srep.example.com' });
    expect(value.rpId).toBe('srep.example.com');
    expect(value.secureCookies).toBe(true);
  });

  it('normalizes a trailing slash and an explicit default port', () => {
    expect(ok({ SREP_ORIGIN: 'https://srep.example.com:443/' }).origin).toBe(
      'https://srep.example.com',
    );
  });

  it('accepts a parent domain as RP ID', () => {
    const value = ok({ SREP_ORIGIN: 'https://srep.example.com', SREP_RP_ID: 'example.com' });
    expect(value.rpId).toBe('example.com');
  });

  it('rejects an RP ID that does not match and names both values', () => {
    const [message] = errors({ SREP_ORIGIN: 'https://srep.example.com', SREP_RP_ID: 'other.com' });
    expect(message).toContain('SREP_RP_ID');
    expect(message).toContain('other.com');
    expect(message).toContain('srep.example.com');
  });

  it('rejects a suffix without a dot boundary', () => {
    expect(
      errors({ SREP_ORIGIN: 'https://srep.example.com', SREP_RP_ID: 'notexample.com' }),
    ).toHaveLength(1);
  });

  it.each(['EXAMPLE.com', 'https://example.com', 'example.com:3000', 'example.com/x'])(
    'rejects the RP ID %s',
    (rpId) => {
      expect(errors({ SREP_ORIGIN: 'https://example.com', SREP_RP_ID: rpId })).toHaveLength(1);
    },
  );

  it('rejects a bare RP ID without a dot', () => {
    expect(errors({ SREP_ORIGIN: 'https://intranet', SREP_RP_ID: 'intranet' })[0]).toContain(
      'must contain a dot',
    );
  });

  it('rejects http on a host that is not localhost', () => {
    expect(errors({ SREP_ORIGIN: 'http://srep.example.com' })).toEqual([
      'SREP_ORIGIN: must use https, or http on localhost',
    ]);
  });

  it('accepts http on localhost with a port', () => {
    expect(ok({ SREP_ORIGIN: 'http://localhost:5173' }).origin).toBe('http://localhost:5173');
  });

  it.each(['http://127.0.0.1:3000', 'https://[::1]', 'https://10.0.0.1'])(
    'rejects the IP origin %s',
    (origin) => {
      const [message] = errors({ SREP_ORIGIN: origin });
      expect(message).toContain('SREP_ORIGIN');
    },
  );

  it.each([
    'https://example.com/x',
    'https://example.com/?a=1',
    'https://example.com/#h',
    'https://user:pw@example.com',
  ])('rejects the origin %s', (origin) => {
    expect(errors({ SREP_ORIGIN: origin })).toEqual([
      'SREP_ORIGIN: must be an origin without path, query or credentials',
    ]);
  });

  it('rejects a value that is not a URL', () => {
    expect(errors({ SREP_ORIGIN: 'not a url' })).toEqual(['SREP_ORIGIN: must be a valid URL']);
  });

  // Regression: a trailing dot was accepted. WebAuthn then failed at run time.
  it('rejects a host with a trailing dot', () => {
    expect(errors({ SREP_ORIGIN: 'https://example.com.' })).toEqual([
      'SREP_ORIGIN: host must not end with a dot',
    ]);
  });

  // Regression: an upper-case RP ID gave a "does not match" message. The real problem is the case.
  it('names the case problem for an upper-case RP ID', () => {
    expect(errors({ SREP_ORIGIN: 'https://srep.example.com', SREP_RP_ID: 'Example.com' })).toEqual([
      'SREP_RP_ID: "Example.com" must be lowercase',
    ]);
  });

  it('treats blank values as unset', () => {
    expect(ok({ SREP_ORIGIN: '', SREP_RP_ID: '', SREP_RP_NAME: '' }).rpId).toBe('localhost');
  });

  it('checks the RP name length and characters', () => {
    expect(ok({ SREP_RP_NAME: '  My srep  ' }).rpName).toBe('My srep');
    expect(errors({ SREP_RP_NAME: 'a'.repeat(65) })).toHaveLength(1);
    expect(errors({ SREP_RP_NAME: 'bad\nname' })).toHaveLength(1);
    expect(errors({ SREP_RP_NAME: 'bad\u0085name' })).toHaveLength(1);
    expect(ok({ SREP_RP_NAME: 'Café ✓' }).rpName).toBe('Café ✓');
    expect(ok({ SREP_RP_NAME: 'a'.repeat(64) }).rpName).toHaveLength(64);
  });

  it('returns all errors together', () => {
    const list = errors({ SREP_ORIGIN: 'http://example.com', SREP_RP_NAME: 'x'.repeat(70) });
    expect(list).toHaveLength(2);
  });
});
