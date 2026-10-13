// Contract: the gallery document must not enter a cache.
// The layout data on this page includes the session CSRF token.
// The Vary header names the session cookie.

export function galleryCacheHeaders(): Record<string, string> {
  return { 'cache-control': 'no-store', vary: 'Cookie' };
}
