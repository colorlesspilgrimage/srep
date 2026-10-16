<script lang="ts">
  import { deckLevel, visibleDeckRows } from './deck-tree-state.js';
  import type { DeckView } from './deck-screen.js';

  // Contract: the deck tree. Each row shows subtree New, Learning, and Due.
  // A row with children has aria-expanded. Keys are handled by the parent.

  type Props = {
    decks: readonly DeckView[];
    expanded: ReadonlySet<string>;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onKeydown: (event: KeyboardEvent) => void;
  };

  let { decks, expanded, selectedId, onSelect, onKeydown }: Props = $props();
  let root = $state<HTMLDivElement | null>(null);

  const visible = $derived(visibleDeckRows(decks, expanded));

  function hasChildren(id: string): boolean {
    return decks.some((deck) => deck.parentId === id);
  }

  function pick(id: string): void {
    onSelect(id);
    root?.focus();
  }

  function onRowKey(event: KeyboardEvent, id: string): void {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === 'Enter') {
      pick(id);
    }
  }
</script>

<div
  class="app-tree"
  role="tree"
  aria-label="Decks"
  tabindex="0"
  bind:this={root}
  onkeydown={onKeydown}
>
  {#each visible as row (row.id)}
    <div
      class="app-tree-row"
      role="treeitem"
      aria-level={deckLevel(decks, row.id)}
      aria-selected={row.id === selectedId}
      aria-expanded={hasChildren(row.id) ? expanded.has(row.id) : undefined}
      data-level={deckLevel(decks, row.id)}
      tabindex="-1"
      onclick={() => pick(row.id)}
      onkeydown={(event) => onRowKey(event, row.id)}
    >
      <span>{row.name}</span>
      <span>New {row.subtree.new}</span>
      <span>Learning {row.subtree.learning}</span>
      <span>Due {row.subtree.due}</span>
    </div>
  {/each}
</div>
