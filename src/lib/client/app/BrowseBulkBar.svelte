<script lang="ts">
  import NoteDeckList from './NoteDeckList.svelte';
  import type { BrowseDeck } from './browse-model.js';

  // Contract: bulk controls for the browse table.
  // Move uses the deck listbox. Tag uses one text field.
  // Disabled buttons do not call the parent.

  type Props = {
    decks: readonly BrowseDeck[];
    deckIndex: number;
    tagText: string;
    busy: boolean;
    moveOn: boolean;
    suspendOn: boolean;
    tagOn: boolean;
    deleteOn: boolean;
    cardCap: string;
    noteCap: string;
    onDeckIndex: (index: number) => void;
    onTagText: (value: string) => void;
    onMove: () => void;
    onAdd: () => void;
    onRemove: () => void;
    onSuspend: () => void;
    onDelete: () => void;
  };

  let {
    decks,
    deckIndex,
    tagText,
    busy,
    moveOn,
    suspendOn,
    tagOn,
    deleteOn,
    cardCap,
    noteCap,
    onDeckIndex,
    onTagText,
    onMove,
    onAdd,
    onRemove,
    onSuspend,
    onDelete,
  }: Props = $props();

  function onTagInput(event: Event): void {
    const node = event.currentTarget;
    if (node instanceof HTMLInputElement) {
      onTagText(node.value);
    }
  }
</script>

<div class="browse-bulk" id="browse-bulk">
  {#if cardCap !== ''}
    <p>{cardCap}</p>
  {/if}
  {#if noteCap !== ''}
    <p>{noteCap}</p>
  {/if}
  <NoteDeckList {decks} index={deckIndex} locked={busy} onIndex={onDeckIndex} />
  <button type="button" disabled={busy || !moveOn} onclick={onMove}>Move</button>
  <label for="browse-tag">Tag</label>
  <input id="browse-tag" type="text" value={tagText} disabled={busy} oninput={onTagInput} />
  <button type="button" disabled={busy || !tagOn} onclick={onAdd}>Add tag</button>
  <button type="button" disabled={busy || !tagOn} onclick={onRemove}>Remove tag</button>
  <button type="button" disabled={busy || !suspendOn} onclick={onSuspend}>Suspend</button>
  <button type="button" disabled={busy || !deleteOn} onclick={onDelete}>Delete</button>
</div>
