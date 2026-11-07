<script lang="ts">
  import AppIcon from './AppIcon.svelte';
  import { deckRowDomId } from './deck-id.js';
  import { deckLevel, visibleDeckRows } from './deck-tree-state.js';
  import type { DeckView } from './deck-screen.js';

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
    <div class="app-empty-inline">
      <AppIcon name="folder" size={18} />
      <p>No decks yet.</p>
    </div>
  {:else}
    {#each visible as row (row.id)}
      {@const level = deckLevel(decks, row.id)}
      {@const open = hasChildren(row.id) ? expanded.has(row.id) : undefined}
      <div
        id={deckRowDomId(row.id) ?? undefined}
        class="app-tree-row"
        class:app-tree-row-open={open === true}
        role="treeitem"
        aria-level={level}
        aria-selected={row.id === selectedId}
        aria-expanded={open}
        data-level={level}
        tabindex="-1"
        onclick={() => pick(row.id)}
        onkeydown={(event) => onRowKey(event, row.id)}
      >
        <span class="app-tree-label">
          {#if hasChildren(row.id)}
            <span class="app-tree-chevron" class:app-tree-chevron-open={open}>
              <AppIcon name="chevron" size={14} />
            </span>
          {:else}
            <span class="app-tree-chevron app-tree-chevron-spacer"></span>
          {/if}
          <span class="app-tree-name">{row.name}</span>
        </span>
        <span class="app-tree-counts">
          <span class="app-chip app-chip-new">New {row.subtree.new}</span>
          <span class="app-chip app-chip-learn">Learning {row.subtree.learning}</span>
          <span class="app-chip app-chip-due">Due {row.subtree.due}</span>
        </span>
      </div>
    {/each}
  {/if}
</div>
