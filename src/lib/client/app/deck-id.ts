// Contract: a deck id may enter a URL path only after this check.
// The id must match the UUID form. The check uses the i flag.
// A match is then encoded. A failed check returns null. The caller must not fetch.
// No I/O.

const DECK_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDeckUuid(id: string): boolean {
  return DECK_UUID.test(id);
}

export function deckResourcePath(id: string, kind: 'item' | 'impact'): string | null {
  if (!isDeckUuid(id)) {
    return null;
  }
  const encoded = encodeURIComponent(id);
  if (kind === 'impact') {
    return `/api/decks/${encoded}/impact`;
  }
  return `/api/decks/${encoded}`;
}
