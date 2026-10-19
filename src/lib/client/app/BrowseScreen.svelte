<script lang="ts">
  import { onMount } from 'svelte';
  import type { ApiResult } from '#lib/client/api.js';
  import { withBusy } from './action-lock.js';
  import BrowseBulkBar from './BrowseBulkBar.svelte';
  import BrowseDeleteDialog from './BrowseDeleteDialog.svelte';
  import BrowseGrid from './BrowseGrid.svelte';
  import { createBrowseClient } from './browse-client.js';
  import { createBrowseHandlers } from './browse-handlers.js';
  import { type BrowseKeyInput, type BrowseRegion } from './browse-keys.js';
  import {
    BAD_QUERY_TEXT,
    EMPTY_TEXT,
    cardCapText,
    indexOfCard,
    keptSelection,
    moveAllowed,
    noteCapText,
    noteWriteAllowed,
    parseBrowsePage,
    parseDeckList,
    searchEffect,
    selectedCardIds,
    selectedNoteIds,
    tagIsSendable,
    writeMessage,
    type BrowseDeck,
    type BrowseView,
  } from './browse-model.js';

  // Contract: the browse page. Search uses URLSearchParams inside the client.
  // One bulk write runs at a time. A second call does not send another request.
  // A later search wins. A failed write stays on screen so the user can retry.
  // Front text is a text node. It is not HTML.

  type Props = {
    paletteOpen?: boolean;
    modalOpen?: boolean;
  };

  let { paletteOpen = false, modalOpen = $bindable(false) }: Props = $props();
  const client = createBrowseClient();

  let query = $state('');
  let rows = $state<BrowseView[]>([]);
  let decks = $state<BrowseDeck[]>([]);
  let selected = $state<string[]>([]);
  let active = $state(0);
  let deckIndex = $state(0);
  let tagText = $state('');
  let message = $state('');
  let badQuery = $state(false);
  let loaded = $state(false);
  let busy = $state(false);
  let ready = $state(false);
  let serial = 0;
  let alive = true;
  let searchField = $state<HTMLInputElement | null>(null);
  let grid = $state<HTMLElement | null>(null);

  const cardCount = $derived(selectedCardIds(rows, selected).length);
  const noteCount = $derived(selectedNoteIds(rows, selected).length);
  const moveOn = $derived(moveAllowed(cardCount) && decks.length > 0);
  const suspendOn = $derived(moveAllowed(cardCount));
  const deleteOn = $derived(noteWriteAllowed(noteCount));
  const tagOn = $derived(noteWriteAllowed(noteCount) && tagIsSendable(tagText));

  function keyInput(region: BrowseRegion, event: KeyboardEvent): BrowseKeyInput {
    return {
      key: event.key,
      region,
      modalOpen,
      paletteOpen,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      queryEmpty: query.length === 0,
      hasSelection: selected.length > 0,
    };
  }

  function applyRows(next: readonly BrowseView[]): void {
    const previous = rows[active]?.cardId ?? null;
    rows = [...next];
    active = indexOfCard(rows, previous);
    selected = keptSelection(rows, selected);
    badQuery = false;
    message = '';
    loaded = true;
  }

  function showSearch(effect: ReturnType<typeof searchEffect>): void {
    if (effect.type === 'ignore') {
      return;
    }
    if (effect.type === 'bad-query') {
      badQuery = true;
      message = '';
      rows = [];
      selected = [];
      loaded = true;
      return;
    }
    if (effect.type === 'error') {
      badQuery = false;
      message = effect.message;
      loaded = true;
      return;
    }
    applyRows(effect.rows);
  }

  async function loadSearch(q: string): Promise<void> {
    serial += 1;
    const mine = serial;
    const result = await client.search(q);
    if (!alive) {
      return;
    }
    const parsed = result.ok ? parseBrowsePage(result.body) : null;
    showSearch(
      searchEffect({
        alive,
        mine,
        serial,
        ok: result.ok,
        error: result.ok ? '' : result.error,
        rows: parsed,
      }),
    );
  }

  async function loadDecks(): Promise<void> {
    const result = await client.listDecks();
    if (!alive || !result.ok) {
      return;
    }
    const parsed = parseDeckList(result.body);
    if (parsed === null) {
      return;
    }
    decks = parsed;
    if (deckIndex >= decks.length) {
      deckIndex = 0;
    }
  }

  async function finishWrite(result: ApiResult<unknown>): Promise<void> {
    if (!alive) {
      return;
    }
    if (!result.ok) {
      message = writeMessage(result.error);
      badQuery = false;
      return;
    }
    tagText = '';
    selected = [];
    modalOpen = false;
    await loadSearch(query);
  }

  function runBulk(task: () => Promise<void>): void {
    void withBusy(
      () => busy,
      (value) => {
        busy = value;
      },
      ready,
      task,
    );
  }

  function onSearch(): void {
    if (!ready || busy) {
      return;
    }
    void loadSearch(query);
  }

  const handlers = createBrowseHandlers({
    snap: () => ({
      query,
      rows,
      selected,
      active,
      decks,
      deckIndex,
      tagText,
      modalOpen,
      busy,
      ready,
      paletteOpen,
    }),
    patch: (value) => {
      if (value.query !== undefined) {
        query = value.query;
      }
      if (value.selected !== undefined) {
        selected = value.selected;
      }
      if (value.active !== undefined) {
        active = value.active;
      }
      if (value.message !== undefined) {
        message = value.message;
      }
      if (value.modalOpen !== undefined) {
        modalOpen = value.modalOpen;
      }
    },
    keyInput,
    searchField: () => searchField,
    grid: () => grid,
    client,
    runBulk,
    finishWrite,
    onSearch,
  });

  onMount(() => {
    alive = true;
    ready = true;
    void loadDecks();
    void loadSearch('');
    return () => {
      alive = false;
    };
  });
</script>

<main class="app-screen browse-screen">
  <h1>Browse</h1>
  {#if message !== ''}
    <p role="alert">{message}</p>
  {/if}
  <div class="browse-search">
    <label for="browse-search">Search</label>
    <input
      id="browse-search"
      type="text"
      bind:value={query}
      bind:this={searchField}
      onkeydown={handlers.onQueryKey}
    />
    <button type="button" disabled={!ready || busy} onclick={onSearch}>Search</button>
  </div>
  {#if badQuery}
    <p role="alert">{BAD_QUERY_TEXT}</p>
  {:else if loaded && rows.length === 0}
    <p>{EMPTY_TEXT}</p>
  {/if}
  <BrowseGrid
    {rows}
    {active}
    {selected}
    bind:grid
    onKeydown={handlers.onGridKey}
    onPick={handlers.onPick}
    onCheck={handlers.onCheck}
  />
  <BrowseBulkBar
    {decks}
    {deckIndex}
    {tagText}
    {busy}
    {moveOn}
    {suspendOn}
    {tagOn}
    {deleteOn}
    cardCap={cardCapText(cardCount)}
    noteCap={noteCapText(noteCount)}
    onDeckIndex={(index) => (deckIndex = index)}
    onTagText={(value) => (tagText = value)}
    onMove={handlers.onMove}
    onAdd={handlers.onAdd}
    onRemove={handlers.onRemove}
    onSuspend={handlers.onSuspend}
    onDelete={handlers.onDelete}
  />
  {#if modalOpen}
    <BrowseDeleteDialog
      {busy}
      onClose={handlers.onCloseDelete}
      onConfirm={handlers.onConfirmDelete}
    />
  {/if}
</main>
