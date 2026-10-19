<script lang="ts">
  import type { BrowseView } from './browse-model.js';

  // Contract: the browse table. Front text is a text node.
  // A row click selects that row and focuses the grid.

  type Props = {
    rows: readonly BrowseView[];
    active: number;
    selected: readonly string[];
    onKeydown: (event: KeyboardEvent) => void;
    onPick: (index: number) => void;
    onCheck: (cardId: string, index: number) => void;
    grid?: HTMLElement | null;
  };

  let {
    rows,
    active,
    selected,
    onKeydown,
    onPick,
    onCheck,
    grid = $bindable(null),
  }: Props = $props();

  function onRowKey(event: KeyboardEvent, cardId: string, index: number): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === ' ') {
      onCheck(cardId, index);
      return;
    }
    onPick(index);
  }
</script>

<div
  class="browse-grid"
  role="grid"
  aria-label="Cards"
  tabindex="0"
  bind:this={grid}
  onkeydown={onKeydown}
>
  <div role="row">
    <span role="columnheader">Deck</span>
    <span role="columnheader">Front</span>
    <span role="columnheader">Tags</span>
    <span role="columnheader">State</span>
    <span role="columnheader">Lapses</span>
  </div>
  {#each rows as row, index (row.cardId)}
    <div
      class="browse-row"
      role="row"
      id="browse-row-{row.cardId}"
      tabindex="-1"
      aria-selected={index === active}
      onclick={() => onPick(index)}
      onkeydown={(event) => onRowKey(event, row.cardId, index)}
    >
      <span role="gridcell">{row.deckPath}</span>
      <span role="gridcell">{row.frontText}</span>
      <span role="gridcell">{row.tags}</span>
      <span role="gridcell">{row.state}</span>
      <span role="gridcell">{row.lapses}</span>
      <span role="gridcell">
        <label>
          <input
            type="checkbox"
            checked={selected.includes(row.cardId)}
            onchange={() => onCheck(row.cardId, index)}
          />
          Select {row.frontText}
        </label>
      </span>
    </div>
  {/each}
</div>
