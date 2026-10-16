// Contract: a deck id may enter a URL path or a DOM id only after this check.
// The id must match the UUID form and be 36 characters. The check uses the i flag.
// A match is then encoded. A failed check returns null. The caller must not fetch.
// No I/O.

const DECK_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDeckUuid(id: string): boolean {
  return id.length === 36 && DECK_UUID.test(id);
}

// A row id is a fixed prefix plus the UUID. A bad id does not enter the DOM id.
export function deckRowDomId(id: string): string | null {
  if (!isDeckUuid(id)) {
    return null;
  }
  return `deck-row-${id}`;
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
