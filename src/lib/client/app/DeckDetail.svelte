<script lang="ts">
  // Contract: the deck name field and the create, rename, and delete buttons.
  // Enter in the field saves the rename. Escape blurs the field.
  // This file does not call the network.

  type Props = {
    name: string;
    ready: boolean;
    busy: boolean;
    canEdit: boolean;
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
    nameField = $bindable(null),
    onName,
    onCreateChild,
    onCreateRoot,
    onRename,
    onDelete,
  }: Props = $props();

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
</div>
