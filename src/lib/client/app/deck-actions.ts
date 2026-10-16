// Contract: load the deck list and the count list for the home screen.
// Both reads run together. A failure becomes a short message.
// No path is built here.

import type { ApiResult } from '#lib/client/api.js';
import { appMessageFor } from './app-messages.js';
import { joinDeckViews, type CountRow, type DeckListRow, type DeckView } from './deck-screen.js';

export type DeckClient = {
  getDecks: () => Promise<ApiResult<{ decks: DeckListRow[] }>>;
  getCounts: () => Promise<ApiResult<{ counts: CountRow[] }>>;
  createDeck: (body: {
    name: string;
    parentId: string | null;
  }) => Promise<ApiResult<{ deck: { id: string } }>>;
  renameDeck: (id: string, name: string) => Promise<ApiResult<{ decks: unknown[] }>>;
  deleteDeck: (
    id: string,
    body: { action: 'trash' } | { action: 'move'; targetDeckId: string },
  ) => Promise<ApiResult<{ ok: boolean }>>;
  readImpact: (id: string) => Promise<ApiResult<{ decks: number; cards: number; notes: number }>>;
};

export type LoadDeckResult = { ok: true; decks: DeckView[] } | { ok: false; message: string };

export async function loadDeckScreen(client: DeckClient): Promise<LoadDeckResult> {
  const [listed, counts] = await Promise.all([client.getDecks(), client.getCounts()]);
  if (!listed.ok) {
    return { ok: false, message: appMessageFor(listed.error) };
  }
  if (!counts.ok) {
    return { ok: false, message: appMessageFor(counts.error) };
  }
  return { ok: true, decks: joinDeckViews(listed.body.decks, counts.body.counts) };
}
