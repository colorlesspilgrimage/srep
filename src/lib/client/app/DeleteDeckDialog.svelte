<script lang="ts">
  import { appMessageFor } from './app-messages.js';
  import { createDeckClient } from './deck-api.js';

  // Contract: delete dialog. It loads impact when it opens.
  // A deck id that fails the UUID check does not call fetch.
  // Trash and Move use apiFetch. Escape closes and does not delete.
  // Enter is left to the focused button.

  type Impact = { decks: number; cards: number; notes: number };
  type Target = { id: string; name: string };

  type Props = {
    deckId: string;
    deckName: string;
    targets: readonly Target[];
    onClose: () => void;
    onDone: () => void;
  };

  let { deckId, deckName, targets, onClose, onDone }: Props = $props();
  const client = createDeckClient();

  let impact = $state<Impact | null>(null);
  let message = $state('');
  let targetId = $state('');
  let busy = $state(false);

  function focusOnMount(node: HTMLElement): void {
    node.focus();
  }

  function activatesControl(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    const tag = target.tagName;
    return tag === 'BUTTON' || tag === 'SELECT' || tag === 'INPUT';
  }

  $effect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === ' ' && !activatesControl(event.target)) {
        event.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  });

  async function trash(): Promise<void> {
    if (busy) {
      return;
    }
    busy = true;
    const result = await client.deleteDeck(deckId, { action: 'trash' });
    busy = false;
    if (!result.ok) {
      message = appMessageFor(result.error);
      return;
    }
    onDone();
  }

  async function move(): Promise<void> {
    if (busy || targetId === '') {
      return;
    }
    busy = true;
    const result = await client.deleteDeck(deckId, { action: 'move', targetDeckId: targetId });
    busy = false;
    if (!result.ok) {
      message = appMessageFor(result.error);
      return;
    }
    onDone();
  }

  $effect(() => {
    const id = deckId;
    impact = null;
    message = '';
    targetId = '';
    let stop = false;
    void client.readImpact(id).then((result) => {
      if (stop) {
        return;
      }
      if (!result.ok) {
        message = appMessageFor(result.error);
        return;
      }
      impact = result.body;
    });
    return () => {
      stop = true;
    };
  });
</script>

<div
  class="tui-modal app-dialog"
  role="dialog"
  aria-modal="true"
  aria-labelledby="delete-deck-title"
  tabindex="-1"
  use:focusOnMount
>
  <h2 id="delete-deck-title">Delete {deckName}</h2>
  {#if impact === null}
    <p>Loading impact.</p>
  {:else}
    <p>Decks {impact.decks}. Cards {impact.cards}. Notes {impact.notes}.</p>
  {/if}
  {#if message !== ''}
    <p role="alert">{message}</p>
  {/if}
  <button type="button" disabled={busy} onclick={onClose}>Cancel</button>
  <button type="button" disabled={busy} onclick={() => void trash()}>Trash</button>
  <label for="move-target">Move target</label>
  <select id="move-target" bind:value={targetId}>
    <option value="">Choose a deck</option>
    {#each targets as target (target.id)}
      <option value={target.id}>{target.name}</option>
    {/each}
  </select>
  <button type="button" disabled={busy || targetId === ''} onclick={() => void move()}>Move</button>
</div>
