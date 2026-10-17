<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { isDeckUuid } from './deck-id.js';
  import { appMessageFor } from './app-messages.js';
  import { nextClozeIndex, wrapCloze } from './cloze-edit.js';
  import { uploadMediaFile } from './media-upload.js';
  import NoteEditorForm from './NoteEditorForm.svelte';
  import NotePreview from './NotePreview.svelte';
  import { createNoteEditorClient } from './note-editor-client.js';
  import {
    duplicateText,
    fieldsForCount,
    type NoteEditorProps,
    insertSlice,
    joinTags,
    mediaToken,
    nextSerial,
    pickBasicTypeId,
    pickDeckIndex,
    PREVIEW_DELAY_MS,
    PREVIEW_FAILED_TEXT,
    previewDecision,
    splitTags,
  } from './note-editor-model.js';
  import { loadEditorLists, loadEditorNote } from './note-editor-load.js';
  import {
    parseEditorNote,
    parsePreview,
    type EditorDeck,
    type EditorType,
    type PreviewCardView,
  } from './note-editor-parse.js';
  import { fieldKeyEffect } from './note-field-keys.js';

  // Contract: add and edit note fields. Preview waits 200 ms and drops a stale reply.
  // A failed preview shows an alert. Save and upload set busy until they finish.
  // A second action while busy does not send another request.
  let { mode, noteId, initialDeckId }: NoteEditorProps = $props();
  const client = createNoteEditorClient();

  let types = $state<EditorType[]>([]);
  let decks = $state<EditorDeck[]>([]);
  let noteTypeId = $state('');
  let fields = $state<string[]>([]);
  let tagText = $state('');
  let deckIndex = $state(0);
  let cards = $state<PreviewCardView[]>([]);
  let message = $state('');
  let previewAlert = $state('');
  let ready = $state(false);
  let busy = $state(false);
  let activeField = $state(0);
  let caretStart = $state(0);
  let caretEnd = $state(0);
  let serial = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let alive = true;

  const fieldNames = $derived(types.find((row) => row.id === noteTypeId)?.fields ?? []);

  function clearPreviewTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function schedulePreview(): void {
    serial = nextSerial(serial);
    const mine = serial;
    clearPreviewTimer();
    timer = setTimeout(() => {
      void sendPreview(mine);
    }, PREVIEW_DELAY_MS);
  }

  async function sendPreview(mine: number): Promise<void> {
    const result = await client.preview(noteTypeId, fields);
    const parsed = result.ok ? parsePreview(result.body) : null;
    const effect = previewDecision({
      alive,
      mine,
      serial,
      ok: result.ok,
      cards: parsed,
    });
    if (effect.type === 'ignore' || !alive) {
      return;
    }
    if (effect.type === 'error') {
      previewAlert = PREVIEW_FAILED_TEXT;
      return;
    }
    previewAlert = '';
    cards = [...effect.cards];
  }

  function remember(index: number, target: EventTarget | null): void {
    if (!(target instanceof HTMLTextAreaElement)) {
      return;
    }
    activeField = index;
    caretStart = target.selectionStart;
    caretEnd = target.selectionEnd;
  }

  function onFieldMark(index: number, event: Event): void {
    remember(index, event.currentTarget);
  }

  function onFieldInput(index: number, event: Event): void {
    if (busy) {
      return;
    }
    const target = event.currentTarget;
    if (!(target instanceof HTMLTextAreaElement)) {
      return;
    }
    const next = fields.slice();
    next[index] = target.value;
    fields = next;
    remember(index, target);
    schedulePreview();
  }

  function writeField(index: number, value: string, caret: number): void {
    const next = fields.slice();
    next[index] = value;
    fields = next;
    caretStart = caret;
    caretEnd = caret;
    schedulePreview();
  }

  function readFocusedField(): void {
    const active = document.activeElement;
    if (!(active instanceof HTMLTextAreaElement) || !active.id.startsWith('note-field-')) {
      return;
    }
    const index = Number(active.id.slice('note-field-'.length));
    if (Number.isInteger(index)) {
      remember(index, active);
    }
  }

  function applyWrap(index: number): void {
    if (busy) {
      return;
    }
    readFocusedField();
    const current = fields[activeField] ?? '';
    const wrapped = wrapCloze(current, caretStart, caretEnd, index);
    if (wrapped === null) {
      return;
    }
    writeField(activeField, wrapped, caretStart + wrapped.length - current.length);
  }

  function onNextCloze(): void {
    applyWrap(nextClozeIndex(fields[activeField] ?? ''));
  }

  function onFieldKey(index: number, event: KeyboardEvent): void {
    remember(index, event.currentTarget);
    const effect = fieldKeyEffect({
      key: event.key,
      code: event.code,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });
    if (effect.type === 'pass') {
      return;
    }
    event.preventDefault();
    if (effect.type === 'blur' && event.currentTarget instanceof HTMLElement) {
      event.currentTarget.blur();
      return;
    }
    if (effect.type === 'cloze') {
      onNextCloze();
    }
  }

  function onType(id: string): void {
    if (mode === 'edit' || busy) {
      return;
    }
    noteTypeId = id;
    const count = types.find((row) => row.id === id)?.fields.length ?? 0;
    fields = fieldsForCount(fields, count);
    if (activeField >= fields.length) {
      activeField = 0;
    }
    schedulePreview();
  }

  function takeFile(event: Event): File | undefined {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) {
      return undefined;
    }
    const chosen = input.files?.[0];
    input.value = '';
    return chosen;
  }

  function applyUpload(result: { ok: true; sha256: string } | { ok: false; error: string }): void {
    if (!result.ok) {
      message = appMessageFor(result.error);
      return;
    }
    const token = mediaToken(result.sha256);
    if (token === null) {
      message = appMessageFor('bad_request');
      return;
    }
    message = '';
    const current = fields[activeField] ?? '';
    writeField(
      activeField,
      insertSlice(current, caretStart, caretEnd, token),
      caretStart + token.length,
    );
  }

  async function onFile(event: Event): Promise<void> {
    const chosen = takeFile(event);
    if (chosen === undefined || !ready || busy) {
      return;
    }
    busy = true;
    message = '';
    const result = await uploadMediaFile(chosen);
    if (!alive) {
      return;
    }
    busy = false;
    applyUpload(result);
  }

  async function openCreated(id: string): Promise<void> {
    if (!isDeckUuid(id)) {
      message = appMessageFor('bad_request');
      return;
    }
    await goto(resolve('/notes/[id]', { id }));
  }

  async function onSave(): Promise<void> {
    const deck = decks[deckIndex];
    if (!ready || busy) {
      return;
    }
    if (deck === undefined || noteTypeId === '') {
      message = appMessageFor('bad_request');
      return;
    }
    busy = true;
    message = '';
    const tags = splitTags(tagText);
    const result =
      mode === 'new'
        ? await client.createNote({ noteTypeId, deckId: deck.id, fields: [...fields], tags })
        : await client.patchNote(noteId ?? '', { fields: [...fields], tags, deckId: deck.id });
    if (!alive) {
      return;
    }
    if (!result.ok) {
      busy = false;
      message = appMessageFor(result.error);
      return;
    }
    const note = parseEditorNote(result.body);
    if (note === null) {
      busy = false;
      message = appMessageFor('bad_request');
      return;
    }
    if (mode === 'new') {
      await openCreated(note.id);
      if (alive) {
        busy = false;
      }
      return;
    }
    fields = [...note.fields];
    tagText = joinTags(note.tags);
    message = duplicateText(note.duplicates);
    busy = false;
  }

  function applyNote(note: NonNullable<ReturnType<typeof parseEditorNote>>): void {
    noteTypeId = note.noteTypeId;
    fields = [...note.fields];
    tagText = joinTags(note.tags);
    deckIndex = pickDeckIndex(decks, note.deckId);
    message = duplicateText(note.duplicates);
  }

  async function loadNote(id: string): Promise<boolean> {
    const result = await loadEditorNote(client, id);
    if (!alive) {
      return false;
    }
    if (!result.ok) {
      message = appMessageFor(result.error);
      return false;
    }
    applyNote(result.note);
    return true;
  }

  async function loadEditor(): Promise<void> {
    const lists = await loadEditorLists(client);
    if (!alive) {
      return;
    }
    if (!lists.ok) {
      message = appMessageFor(lists.error);
      return;
    }
    decks = lists.decks;
    types = lists.types;
    if (mode === 'edit') {
      if (noteId !== null && (await loadNote(noteId))) {
        schedulePreview();
      }
      return;
    }
    noteTypeId = pickBasicTypeId(types) ?? '';
    const count = types.find((row) => row.id === noteTypeId)?.fields.length ?? 0;
    fields = fieldsForCount([], count);
    deckIndex = pickDeckIndex(decks, initialDeckId);
    schedulePreview();
  }

  onMount(() => {
    void loadEditor().finally(() => {
      if (alive) {
        ready = true;
      }
    });
    return () => {
      alive = false;
      clearPreviewTimer();
    };
  });
</script>

<main class="app-screen note-editor">
  <h1>{mode === 'new' ? 'Add note' : 'Edit note'}</h1>
  {#if previewAlert !== ''}
    <p role="alert">{previewAlert}</p>
  {/if}
  {#if message !== ''}
    <p role="status">{message}</p>
  {/if}
  {#if !ready && message === ''}
    <p>Loading.</p>
  {/if}
  <NotePreview {cards} />
  <NoteEditorForm
    {types}
    {noteTypeId}
    typeLocked={mode === 'edit'}
    {fieldNames}
    {fields}
    {tagText}
    {decks}
    {deckIndex}
    {ready}
    {busy}
    {onType}
    {onFieldInput}
    {onFieldKey}
    {onFieldMark}
    onTags={(value) => {
      if (!busy) {
        tagText = value;
      }
    }}
    onDeckIndex={(index) => {
      if (!busy) {
        deckIndex = index;
      }
    }}
    onCloze={applyWrap}
    {onNextCloze}
    {onSave}
    {onFile}
  />
</main>
