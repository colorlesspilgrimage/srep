<script lang="ts">
  import { deckRowDomId } from './deck-id.js';
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
  const activeDomId = $derived.by(() => {
    if (selectedId === null || !visible.some((row) => row.id === selectedId)) {
      return undefined;
    }
    return deckRowDomId(selectedId) ?? undefined;
  });

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
  aria-activedescendant={activeDomId}
  tabindex="0"
  bind:this={root}
  onkeydown={onKeydown}
>
  {#if visible.length === 0}
    <p class="app-empty-inline">No decks yet.</p>
  {:else}
    {#each visible as row (row.id)}
      {@const level = deckLevel(decks, row.id)}
      <div
        id={deckRowDomId(row.id) ?? undefined}
        class="app-tree-row"
        role="treeitem"
        aria-level={level}
        aria-selected={row.id === selectedId}
        aria-expanded={hasChildren(row.id) ? expanded.has(row.id) : undefined}
        data-level={level}
        tabindex="-1"
        onclick={() => pick(row.id)}
        onkeydown={(event) => onRowKey(event, row.id)}
      >
        <span class="app-tree-name">{row.name}</span>
        <span class="app-tree-counts">
          <span class="app-metric">New {row.subtree.new}</span>
          <span class="app-metric">Learning {row.subtree.learning}</span>
          <span class="app-metric">Due {row.subtree.due}</span>
        </span>
      </div>
    {/each}
  {/if}
</div>
