<script lang="ts">
  import { resolve } from '$app/paths';
  import AppIcon from './AppIcon.svelte';
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

<section class="app-detail" aria-label="Deck actions">
  <div class="app-detail-head">
    <AppIcon name="folder" size={18} />
    <p class="tui-eyebrow">Selected deck</p>
  </div>
  {#if !canEdit}
    <p class="app-lead">
      Pick a deck in the tree, or create a root deck to start a library.
    </p>
  {/if}
  <div class="app-detail-field">
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
  </div>
  <!-- resolve() has no query slot. The id is encoded after the UUID check. -->
  <!-- eslint-disable svelte/no-navigation-without-resolve -->
  <div class="app-detail-primary">
    {#if studyHref !== null}
      <a class="app-action app-action-strong" href={studyHref}>
        <AppIcon name="study" size={16} />
        <span>Study</span>
      </a>
    {/if}
    {#if addHref !== null}
      <a class="app-action" href={addHref}>
        <AppIcon name="note" size={16} />
        <span>Add note</span>
      </a>
    {/if}
  </div>
  <!-- eslint-enable svelte/no-navigation-without-resolve -->
  <div class="app-detail-secondary" role="group" aria-label="Deck edits">
    <button type="button" disabled={locked} onclick={onCreateRoot}>
      <AppIcon name="plus" size={15} />
      <span>Create root</span>
    </button>
    <button type="button" disabled={locked || !canEdit} onclick={onCreateChild}>
      <AppIcon name="plus" size={15} />
      <span>Create child</span>
    </button>
    <button type="button" disabled={locked || !canEdit} onclick={onRename}>
      <AppIcon name="pencil" size={15} />
      <span>Rename</span>
    </button>
    <button type="button" class="app-danger" disabled={locked || !canEdit} onclick={onDelete}>
      <AppIcon name="trash" size={15} />
      <span>Delete</span>
    </button>
  </div>
</section>
