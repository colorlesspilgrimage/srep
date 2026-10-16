// Contract: headers for a signed-in HTML page.
// The page carries the CSRF token, so a cache must not store it.
// Output: cache-control no-store and vary Cookie. No other headers.
// No I/O.

export function privatePageHeaders(): Record<string, string> {
  return { 'cache-control': 'no-store', vary: 'Cookie' };
}
