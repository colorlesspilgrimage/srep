import { describe, expect, it } from 'vitest';
import { buildSecurityHeaders } from '#lib/server/auth/security-headers.js';

const base = { origin: 'http://localhost:3000', rpId: 'localhost', rpName: 'srep' };

describe('buildSecurityHeaders', () => {
  it('sends HSTS only for https', () => {
    expect(
      buildSecurityHeaders({ ...base, secureCookies: true })['Strict-Transport-Security'],
    ).toBe('max-age=31536000; includeSubDomains');
    expect(buildSecurityHeaders({ ...base, secureCookies: false })).not.toHaveProperty(
      'Strict-Transport-Security',
    );
  });

  it('always sends the other headers and no header holds a newline', () => {
    const headers = buildSecurityHeaders({ ...base, secureCookies: false });
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Referrer-Policy']).toBe('no-referrer');
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(headers['Cross-Origin-Resource-Policy']).toBe('same-origin');
    expect(headers['Permissions-Policy']).toContain('publickey-credentials-get=(self)');
    for (const value of Object.values(headers)) {
      expect(value).not.toMatch(/[\r\n]/);
    }
  });
});
