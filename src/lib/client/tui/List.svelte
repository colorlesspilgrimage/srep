<script lang="ts">
  // Contract: a listbox. Arrow keys stop at the ends. They do not wrap.

  type Props = {
    label: string;
    items: readonly string[];
    selectedIndex: number;
    onSelect: (index: number) => void;
  };

  let { label, items, selectedIndex, onSelect }: Props = $props();

  function selectClamped(index: number): void {
    const last = items.length - 1;
    if (index < 0) {
      onSelect(0);
      return;
    }
    if (index > last) {
      onSelect(last);
      return;
    }
    onSelect(index);
  }

  function onListKey(event: KeyboardEvent): void {
    if (items.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectClamped(selectedIndex + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectClamped(selectedIndex - 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      selectClamped(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      selectClamped(items.length - 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      onSelect(selectedIndex);
    }
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
