<script lang="ts">
  import { resolve } from '$app/paths';
  import { isDeckUuid } from './deck-id.js';
  import { studyDeckQuery } from './study-paths.js';

  // Contract: the deck name field and the create, rename, delete, study, and add-note controls.
  // Enter in the field saves the rename. Escape blurs the field.
  // The Study and Add note hrefs use the deck id only after the UUID check.
  // This file does not call the network.

  type Props = {
    name: string;
    ready: boolean;
    busy: boolean;
    canEdit: boolean;
    deckId: string | null;
    nameField: HTMLInputElement | null;
    onName: (value: string) => void;
    onCreateChild: () => void;
    onCreateRoot: () => void;
    onRename: () => void;
    onDelete: () => void;
  };

  let {
    name,
    ready,
    busy,
    canEdit,
    deckId,
    nameField = $bindable(null),
    onName,
    onCreateChild,
    onCreateRoot,
    onRename,
    onDelete,
  }: Props = $props();

  const studyHref = $derived.by(() => {
    if (deckId === null) {
      return null;
    }
    const id = studyDeckQuery(deckId);
    if (id === null) {
      return null;
    }
    return `${resolve('/study')}?deck=${id}`;
  });

  const addHref = $derived.by(() => {
    if (deckId === null || !isDeckUuid(deckId)) {
      return null;
    }
    return `${resolve('/notes/new')}?deck=${encodeURIComponent(deckId)}`;
  });

  const locked = $derived(!ready || busy);

  function onNameKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      nameField?.blur();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      onRename();
    }
  }

  function onInput(event: Event): void {
    const target = event.currentTarget;
    if (target instanceof HTMLInputElement) {
      onName(target.value);
    }
  }
</script>

<div class="app-detail">
  <label for="deck-name">Deck name</label>
  <input
    id="deck-name"
    type="text"
    maxlength="100"
    autocomplete="off"
    value={name}
    disabled={locked}
    bind:this={nameField}
    oninput={onInput}
    onkeydown={onNameKey}
  />
  <button type="button" disabled={locked || !canEdit} onclick={onCreateChild}>Create child</button>
  <button type="button" disabled={locked} onclick={onCreateRoot}>Create root</button>
  <button type="button" disabled={locked || !canEdit} onclick={onRename}>Rename</button>
  <button type="button" disabled={locked || !canEdit} onclick={onDelete}>Delete</button>
  <!-- resolve() has no query slot. The id is encoded after the UUID check. -->
  <!-- eslint-disable svelte/no-navigation-without-resolve -->
  {#if studyHref !== null}
    <a href={studyHref}>Study</a>
  {/if}
  {#if addHref !== null}
    <a href={addHref}>Add note</a>
  {/if}
  <!-- eslint-enable svelte/no-navigation-without-resolve -->
</div>
