<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { signOut } from '#lib/client/sign-out.js';
  import type { PageData } from './$types';
  import AppShell from '#lib/client/app/AppShell.svelte';
  import DeckDetail from '#lib/client/app/DeckDetail.svelte';
  import DeckTree from '#lib/client/app/DeckTree.svelte';
  import DeleteDeckDialog from '#lib/client/app/DeleteDeckDialog.svelte';
  import { appMessageFor } from '#lib/client/app/app-messages.js';
  import { createDeckClient } from '#lib/client/app/deck-api.js';
  import { loadDeckScreen } from '#lib/client/app/deck-actions.js';
  import { afterMutation, moveTargetIds, type DeckView } from '#lib/client/app/deck-screen.js';
  import { deckTreeKeyAction } from '#lib/client/app/deck-tree-keys.js';
  import { effectForTreeKey, visibleDeckRows } from '#lib/client/app/deck-tree-state.js';
  import { elementIsTextField } from '#lib/client/tui/keymap.js';

  // Contract: the signed-in home page. Guests stay on the auth pages.
  // Svelte 5 rejects a class on svelte:body. This effect adds tui-page.
  // Counts and deck rows load together. A child create expands the parent.

  let { data }: { data: PageData } = $props();
  const client = createDeckClient();

  let decks = $state<DeckView[]>([]);
  let expanded = $state<Set<string>>(new Set());
  let selectedId = $state<string | null>(null);
  let name = $state('');
  let message = $state('');
  let busy = $state(false);
  let ready = $state(false);
  let deleteOpen = $state(false);
  let paletteOpen = $state(false);
  let nameField = $state<HTMLInputElement | null>(null);

  $effect.pre(() => {
    document.body.classList.add('tui-page');
    return () => {
      document.body.classList.remove('tui-page');
    };
  });

  let namedFor = $state<string | null | undefined>(undefined);

  $effect(() => {
    const id = selectedId;
    if (id === namedFor) {
      return;
    }
    namedFor = id;
    name = decks.find((row) => row.id === id)?.name ?? '';
  });

  const targets = $derived.by(() => {
    if (selectedId === null) {
      return [];
    }
    const allowed = new Set(moveTargetIds(decks, selectedId));
    return decks
      .filter((deck) => allowed.has(deck.id))
      .map((deck) => ({
        id: deck.id,
        name: deck.name,
      }));
  });

  const selectedName = $derived(decks.find((deck) => deck.id === selectedId)?.name ?? '');

  async function reload(prefer: string | null, parentId: string | null): Promise<void> {
    const loaded = await loadDeckScreen(client);
    if (!loaded.ok) {
      message = loaded.message;
      return;
    }
    const next = afterMutation({
      decks: loaded.decks,
      expanded,
      selectedId: prefer,
      parentId,
    });
    decks = loaded.decks;
    expanded = next.expanded;
    selectedId = next.selectedId;
    message = '';
  }

  onMount(() => {
    void reload(null, null).finally(() => {
      ready = true;
    });
  });

  async function runCreate(parentId: string | null): Promise<void> {
    if (!ready || busy) {
      return;
    }
    busy = true;
    const result = await client.createDeck({ name, parentId });
    busy = false;
    if (!result.ok) {
      message = appMessageFor(result.error);
      return;
    }
    await reload(result.body.deck.id, parentId);
  }

  function onCreateRoot(): void {
    void runCreate(null);
  }

  function onCreateChild(): void {
    if (selectedId === null) {
      return;
    }
    void runCreate(selectedId);
  }

  async function onRename(): Promise<void> {
    if (!ready || busy || selectedId === null) {
      return;
    }
    busy = true;
    const result = await client.renameDeck(selectedId, name);
    busy = false;
    if (!result.ok) {
      message = appMessageFor(result.error);
      return;
    }
    await reload(selectedId, null);
  }

  function isField(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return elementIsTextField(target.tagName, target.isContentEditable);
  }

  function onTreeKey(event: KeyboardEvent): void {
    const visible = visibleDeckRows(decks, expanded);
    const index = visible.findIndex((row) => row.id === selectedId);
    const row = visible[index];
    if (row === undefined) {
      return;
    }
    const effect = treeEffect(event, row, index, visible);
    if (effect.type === 'ignore') {
      return;
    }
    event.preventDefault();
    if (effect.type === 'prevent') {
      return;
    }
    if (effect.type === 'focus-name') {
      nameField?.focus();
      return;
    }
    selectedId = effect.id;
    expanded = new Set(effect.expandedIds);
  }

  function treeEffect(
    event: KeyboardEvent,
    row: DeckView,
    index: number,
    visible: readonly DeckView[],
  ) {
    return effectForTreeKey(
      deckTreeKeyAction({
        key: event.key,
        shiftKey: event.shiftKey,
        modified: event.altKey || event.ctrlKey || event.metaKey,
        hasChildren: decks.some((deck) => deck.parentId === row.id),
        expanded: expanded.has(row.id),
        isRoot: row.parentId === null,
        targetIsField: isField(event.target),
        modalOpen: deleteOpen,
        paletteOpen,
      }),
      {
        visible,
        index,
        expandedIds: expanded,
        rowId: row.id,
        parentId: row.parentId,
        decks,
      },
    );
  }

  function onSelect(id: string): void {
    selectedId = id;
  }

  function onDelete(): void {
    deleteOpen = true;
  }

  function onCloseDelete(): void {
    deleteOpen = false;
  }

  async function onDeleted(): Promise<void> {
    deleteOpen = false;
    await reload(selectedId, null);
  }

  function onName(value: string): void {
    name = value;
  }

  async function logOut(): Promise<void> {
    await signOut(false);
    await goto(resolve('/login'), { invalidateAll: true });
  }
</script>

<svelte:head><title>srep</title></svelte:head>

<AppShell themeId={data.themeId} keybinds={data.keybinds} modalOpen={deleteOpen} bind:paletteOpen>
  <main class="app-screen">
    <h1>srep</h1>
    <button type="button" onclick={logOut}>Log out</button>
    {#if message !== ''}
      <p role="alert">{message}</p>
    {/if}
    <DeckTree {decks} {expanded} {selectedId} {onSelect} onKeydown={onTreeKey} />
    <DeckDetail
      {name}
      {ready}
      {busy}
      canEdit={selectedId !== null}
      bind:nameField
      {onName}
      {onCreateChild}
      {onCreateRoot}
      {onRename}
      {onDelete}
    />
    {#if deleteOpen && selectedId !== null}
      <DeleteDeckDialog
        deckId={selectedId}
        deckName={selectedName}
        {targets}
        onClose={onCloseDelete}
        onDone={() => void onDeleted()}
      />
    {/if}
  </main>
</AppShell>
