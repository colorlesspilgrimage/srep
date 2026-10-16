<script lang="ts">
  import { nextTrapIndex } from '#lib/client/tui/palette-focus.js';
  import { appMessageFor } from './app-messages.js';
  import { createDeckClient } from './deck-api.js';
  import { shownCount } from './deck-screen.js';
  import { dialogKeyAction } from './dialog-focus.js';

  // Contract: delete dialog. It loads impact when it opens.
  // A deck id that fails the UUID check does not call fetch.
  // Trash and Move use apiFetch. Escape closes and does not delete.
  // Tab stays in the dialog. Close returns focus to the control that opened it.
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
  let dialog = $state<HTMLElement | null>(null);

  const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
  ].join(', ');

  function focusDialog(node: HTMLElement): { destroy: () => void } {
    const previous = document.activeElement;
    const returnFocus = previous instanceof HTMLElement && previous !== node ? previous : null;
    node.focus();
    return {
      destroy(): void {
        if (returnFocus !== null && returnFocus.isConnected) {
          returnFocus.focus();
        }
      },
    };
  }

  function focusableItems(root: HTMLElement): HTMLElement[] {
    const found: HTMLElement[] = [];
    for (const node of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
      if (node.tabIndex < 0 || node.closest('[hidden]') !== null) {
        continue;
      }
      found.push(node);
    }
    return found;
  }

  function trapTab(shiftKey: boolean): void {
    const root = dialog;
    if (root === null) {
      return;
    }
    const items = focusableItems(root);
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = nextTrapIndex(items.length, current, shiftKey);
    const target = next === null ? undefined : items[next];
    if (target !== undefined) {
      target.focus();
    }
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
      const action = dialogKeyAction(event.key, event.shiftKey, activatesControl(event.target));
      if (action.type === 'none') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (action.type === 'close') {
        onClose();
        return;
      }
      if (action.type === 'tab') {
        trapTab(action.shift);
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
      impact = {
        decks: shownCount(result.body.decks),
        cards: shownCount(result.body.cards),
        notes: shownCount(result.body.notes),
      };
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
  bind:this={dialog}
  use:focusDialog
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
