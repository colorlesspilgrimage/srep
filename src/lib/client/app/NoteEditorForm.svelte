<script lang="ts">
  import NoteDeckList from './NoteDeckList.svelte';
  import { MEDIA_ACCEPT } from './media-upload.js';
  import type { EditorDeck, EditorType } from './note-editor-parse.js';

  // Contract: the note form controls. The parent owns the values and the save.
  // Tab order is the fields, then tags, then the deck list, then Save.
  // Cloze buttons and file inputs follow Save so they do not break that order.
  // This file does not call fetch.

  type Props = {
    types: readonly EditorType[];
    noteTypeId: string;
    typeLocked: boolean;
    fieldNames: readonly string[];
    fields: readonly string[];
    tagText: string;
    decks: readonly EditorDeck[];
    deckIndex: number;
    ready: boolean;
    busy: boolean;
    onType: (id: string) => void;
    onFieldInput: (index: number, event: Event) => void;
    onFieldKey: (index: number, event: KeyboardEvent) => void;
    onFieldMark: (index: number, event: Event) => void;
    onTags: (value: string) => void;
    onDeckIndex: (index: number) => void;
    onCloze: (index: number) => void;
    onNextCloze: () => void;
    onSave: () => void;
    onFile: (event: Event) => void;
  };

  let {
    types,
    noteTypeId,
    typeLocked,
    fieldNames,
    fields,
    tagText,
    decks,
    deckIndex,
    ready,
    busy,
    onType,
    onFieldInput,
    onFieldKey,
    onFieldMark,
    onTags,
    onDeckIndex,
    onCloze,
    onNextCloze,
    onSave,
    onFile,
  }: Props = $props();

  const locked = $derived(!ready || busy);

  function onTypeChange(event: Event): void {
    const target = event.currentTarget;
    if (target instanceof HTMLSelectElement) {
      onType(target.value);
    }
  }

  function onTagInput(event: Event): void {
    const target = event.currentTarget;
    if (target instanceof HTMLInputElement) {
      onTags(target.value);
    }
  }

  function keepFieldFocus(event: MouseEvent): void {
    event.preventDefault();
  }
</script>

<label for="note-type">Note type</label>
<select id="note-type" value={noteTypeId} disabled={locked || typeLocked} onchange={onTypeChange}>
  {#each types as type (type.id)}
    <option value={type.id}>{type.name}</option>
  {/each}
</select>
{#each fieldNames as name, index (index)}
  <label for="note-field-{index}">{name}</label>
  <textarea
    id="note-field-{index}"
    rows="3"
    maxlength="50000"
    value={fields[index] ?? ''}
    disabled={locked}
    oninput={(event) => onFieldInput(index, event)}
    onkeydown={(event) => onFieldKey(index, event)}
    onkeyup={(event) => onFieldMark(index, event)}
    onmouseup={(event) => onFieldMark(index, event)}
    onselect={(event) => onFieldMark(index, event)}
    onfocus={(event) => onFieldMark(index, event)}></textarea>
{/each}
<label for="note-tags">Tags</label>
<input
  id="note-tags"
  type="text"
  autocomplete="off"
  value={tagText}
  disabled={locked}
  oninput={onTagInput}
/>
<NoteDeckList {decks} index={deckIndex} onIndex={onDeckIndex} />
<button class="note-save" type="button" disabled={locked} onclick={onSave}>Save</button>
<button type="button" disabled={locked} onmousedown={keepFieldFocus} onclick={() => onCloze(1)}>
  Cloze 1
</button>
<button type="button" disabled={locked} onmousedown={keepFieldFocus} onclick={() => onCloze(2)}>
  Cloze 2
</button>
<button type="button" disabled={locked} onmousedown={keepFieldFocus} onclick={onNextCloze}>
  Next cloze
</button>
<label for="note-upload">Upload</label>
<input
  id="note-upload"
  class="note-upload"
  type="file"
  accept={MEDIA_ACCEPT}
  disabled={locked}
  onchange={onFile}
/>
<label for="note-camera">Camera</label>
<input
  id="note-camera"
  class="note-camera"
  type="file"
  accept={MEDIA_ACCEPT}
  capture="environment"
  disabled={locked}
  onchange={onFile}
/>
