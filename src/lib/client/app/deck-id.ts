const DECK_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDeckUuid(id: string): boolean {
  return id.length === 36 && DECK_UUID.test(id);
}

export function encodedUuid(id: string): string | null {
  if (!isDeckUuid(id)) {
    return null;
  }
  return encodeURIComponent(id);
}

export function deckRowDomId(id: string): string | null {
  if (!isDeckUuid(id)) {
    return null;
  }
  return `deck-row-${id}`;
}

export function deckResourcePath(id: string, kind: 'item' | 'impact'): string | null {
  const encoded = encodedUuid(id);
  if (encoded === null) {
    return null;
  }
  if (kind === 'impact') {
    return `/api/decks/${encoded}/impact`;
  }
  return `/api/decks/${encoded}`;
}
