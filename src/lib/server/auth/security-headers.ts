import type { AuthConfig } from '#lib/server/auth/rp-config.js';

// The CSP header comes from the Kit config in vite.config.ts.
export function buildSecurityHeaders(auth: AuthConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy':
      'publickey-credentials-get=(self), publickey-credentials-create=(self), camera=(), microphone=(), geolocation=()',
  };
  // HSTS must not go over plain http on localhost.
  if (auth.secureCookies) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }
  return headers;
}
