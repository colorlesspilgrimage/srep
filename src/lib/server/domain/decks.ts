import { fail, type Result } from '#lib/server/auth/deps.js';
import { DEFAULT_PRESET_ID } from '#lib/server/domain/builtin.js';
import {
  planDeckCreate,
  planDeckUpdate,
  validateDeckName,
  type DeckPatch,
} from '#lib/server/domain/core/deck-paths.js';
import type { DeckCreateInput, DeckDeleteInput } from '#lib/server/domain/core/validation.js';
import type { DomainDeps } from '#lib/server/domain/deps.js';
import { newId } from '#lib/server/domain/ids.js';
import type { DeckImpact, DeckRow } from '#lib/server/domain/store/store-types.js';

export async function listDecks(deps: DomainDeps): Promise<Result<{ decks: DeckRow[] }>> {
  return { ok: true, decks: await deps.store.listDecks() };
}

export async function getDeck(deps: DomainDeps, id: string): Promise<Result<{ deck: DeckRow }>> {
  const deck = await deps.store.getDeck(id);
  return deck === undefined ? fail(404, 'not_found') : { ok: true, deck };
}

// A deck without a preset uses the preset of its parent. A root deck uses the default.
export async function createDeck(
  deps: DomainDeps,
  input: DeckCreateInput,
): Promise<Result<{ deck: DeckRow }>> {
  const name = validateDeckName(input.name);
  if (name === null) {
    return fail(400, 'bad_request');
  }
  const plan = planDeckCreate(await deps.store.listDecks(), name, input.parentId ?? null);
  if (!plan.ok) {
    return plan;
  }
  if (input.presetId !== undefined && (await deps.store.getPreset(input.presetId)) === undefined) {
    return fail(404, 'not_found');
  }
  const deck: DeckRow = {
    id: newId(deps.random),
    parentId: plan.parent?.id ?? null,
    name,
    path: plan.path,
    presetId: input.presetId ?? plan.parent?.presetId ?? DEFAULT_PRESET_ID,
    description: input.description ?? '',
    archivedAt: null,
  };
  if ((await deps.store.insertDeck(deck)) === 'name_taken') {
    return fail(409, 'deck_name_taken');
  }
  return { ok: true, deck };
}

// Rename, move, preset and description change in one transaction.
export async function updateDeck(
  deps: DomainDeps,
  id: string,
  patch: DeckPatch,
): Promise<Result<{ decks: DeckRow[] }>> {
  if (patch.presetId !== undefined && (await deps.store.getPreset(patch.presetId)) === undefined) {
    return fail(404, 'not_found');
  }
  const result = await deps.store.changeDecks((all) => planDeckUpdate(all, id, patch));
  return result.ok ? { ok: true, decks: result.updates } : result;
}

export async function getDeckImpact(deps: DomainDeps, id: string): Promise<Result<DeckImpact>> {
  const impact = await deps.store.deckImpact(id);
  return impact === undefined ? fail(404, 'not_found') : { ok: true, ...impact };
}

// `move` sends the cards to another deck. `trash` puts their notes in the trash.
export async function deleteDeck(
  deps: DomainDeps,
  id: string,
  input: DeckDeleteInput,
): Promise<Result<object>> {
  const action =
    input.action === 'move'
      ? { kind: 'move' as const, targetDeckId: input.targetDeckId }
      : { kind: 'trash' as const };
  const result = await deps.store.deleteDeckTree(id, action, deps.now());
  if (result === 'not_found' || result === 'target_not_found') {
    return fail(404, 'not_found');
  }
  if (result === 'target_in_subtree') {
    return fail(409, 'deck_cycle');
  }
  return { ok: true };
}
