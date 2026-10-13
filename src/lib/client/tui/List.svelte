<script lang="ts">
  import { listKeyIndex } from './list-state.js';

  // Contract: a listbox. Arrow keys stop at the ends. They do not wrap.
  // Enter selects only a real row.

  type Props = {
    label: string;
    items: readonly string[];
    selectedIndex: number;
    onSelect: (index: number) => void;
  };

  let { label, items, selectedIndex, onSelect }: Props = $props();

  function onListKey(event: KeyboardEvent): void {
    const next = listKeyIndex(items.length, selectedIndex, event.key);
    if (next === null) {
      return;
    }
    event.preventDefault();
    onSelect(next);
  }
</script>

<div class="tui-list" role="listbox" aria-label={label} tabindex="0" onkeydown={onListKey}>
  {#if items.length === 0}
    <p>No items.</p>
  {:else}
    {#each items as item, index (index)}
      <button
        class="tui-option"
        type="button"
        role="option"
        aria-selected={index === selectedIndex}
        onclick={() => onSelect(index)}
      >
        {item}
      </button>
    {/each}
  {/if}
</div>
