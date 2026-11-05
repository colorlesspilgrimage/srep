<script lang="ts">
  import AppIcon from './AppIcon.svelte';
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
  <button type="button" disabled={busy || !moveOn} onclick={onMove}>
    <AppIcon name="move" size={15} />
    <span>Move</span>
  </button>
  <label for="browse-tag">Tag</label>
  <input id="browse-tag" type="text" value={tagText} disabled={busy} oninput={onTagInput} />
  <button type="button" disabled={busy || !tagOn} onclick={onAdd}>
    <AppIcon name="tag" size={15} />
    <span>Add tag</span>
  </button>
  <button type="button" disabled={busy || !tagOn} onclick={onRemove}>
    <AppIcon name="tag" size={15} />
    <span>Remove tag</span>
  </button>
  <button type="button" disabled={busy || !suspendOn} onclick={onSuspend}>
    <AppIcon name="suspend" size={15} />
    <span>Suspend</span>
  </button>
  <button type="button" class="app-danger" disabled={busy || !deleteOn} onclick={onDelete}>
    <AppIcon name="trash" size={15} />
    <span>Delete</span>
  </button>
</div>
