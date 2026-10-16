<script lang="ts">
  import { onMount } from 'svelte';
  import { nextTrapIndex } from '#lib/client/tui/palette-focus.js';
  import { appMessageFor } from './app-messages.js';
  import { cardTextFromNote, parseNoteBody } from './study-parse.js';
  import { createStudyClient } from './study-client.js';
  import { dialogKeyAction } from './dialog-focus.js';

  // Contract: edit the note fields for the open card.
  // GET and PATCH use the note id only after the UUID check inside the client.
  // Escape closes and does not save. Tab stays in the dialog.
  // onSaved gets the card id from the moment Save was clicked.
  // onSaved's text is null when that card id is gone. The parent loads the next card.

  type SavedText = { front: string; back: string };

  type Props = {
    noteId: string;
    cardId: string;
    onClose: () => void;
    onSaved: (cardId: string, text: SavedText | null) => void;
  };

  let { noteId, cardId, onClose, onSaved }: Props = $props();
  const client = createStudyClient();

  let fields = $state<string[]>([]);
  let message = $state('');
  let busy = $state(false);
  let alive = true;
  let dialog = $state<HTMLElement | null>(null);

  onMount(() => {
    return () => {
      alive = false;
    };
  });

  const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
  ].join(', ');

  function focusDialog(node: HTMLElement): { destroy: () => void } {
    const previous = document.activeElement;
    const returnFocus = previous instanceof HTMLElement && previous !== node ? previous : null;
    const field = node.querySelector('textarea');
    if (field instanceof HTMLElement) {
      field.focus();
    } else {
      node.focus();
    }
    return {
      destroy(): void {
        const target = returnFocus;
        if (target === null) {
          return;
        }
        queueMicrotask(() => {
          if (target.isConnected) {
            target.focus();
          }
        });
      },
    };
  }

  function focusableItems(root: HTMLElement): HTMLElement[] {
    const found: HTMLElement[] = [];
    for (const node of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
      if (node.tabIndex < 0 || node.closest('[hidden]') !== null) {
        continue;
      }
      found.push(node);
    }
    return found;
  }

  function trapTab(shiftKey: boolean): void {
    const root = dialog;
    if (root === null) {
      return;
    }
    const items = focusableItems(root);
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = nextTrapIndex(items.length, current, shiftKey);
    const target = next === null ? undefined : items[next];
    if (target !== undefined) {
      target.focus();
    }
  }

  function activatesControl(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    const tag = target.tagName;
    return tag === 'BUTTON' || tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA';
  }

  $effect(() => {
    function onKey(event: KeyboardEvent): void {
      const action = dialogKeyAction(event.key, event.shiftKey, activatesControl(event.target));
      if (action.type === 'none') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (action.type === 'close') {
        onClose();
        return;
      }
      if (action.type === 'tab') {
        trapTab(action.shift);
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  });

  $effect(() => {
    if (fields.length === 0 || dialog === null) {
      return;
    }
    const active = document.activeElement;
    const inside = active instanceof Node && dialog.contains(active) && active !== dialog;
    if (inside) {
      return;
    }
    const field = dialog.querySelector('textarea');
    if (field instanceof HTMLTextAreaElement) {
      field.focus();
    }
  });

  $effect(() => {
    const id = noteId;
    fields = [];
    message = '';
    let stop = false;
    void client.getNote(id).then((result) => {
      if (stop) {
        return;
      }
      if (!result.ok) {
        message = appMessageFor(result.error);
        return;
      }
      const note = parseNoteBody(result.body);
      if (note === null) {
        message = appMessageFor('bad_request');
        return;
      }
      fields = note.fields;
    });
    return () => {
      stop = true;
    };
  });

  function setField(index: number, event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLTextAreaElement)) {
      return;
    }
    const next = fields.slice();
    next[index] = target.value;
    fields = next;
  }

  async function save(): Promise<void> {
    if (busy || fields.length === 0) {
      return;
    }
    const savedCardId = cardId;
    const savedNoteId = noteId;
    const savedFields = fields.slice();
    busy = true;
    const result = await client.patchNote(savedNoteId, savedFields);
    const note = result.ok ? parseNoteBody(result.body) : null;
    if (alive) {
      busy = false;
      if (!result.ok || note === null) {
        message = appMessageFor(result.ok ? 'bad_request' : result.error);
        return;
      }
    }
    if (note === null) {
      return;
    }
    onSaved(savedCardId, cardTextFromNote(note, savedCardId));
  }
</script>

<div
  class="tui-modal app-dialog"
  role="dialog"
  aria-modal="true"
  aria-labelledby="edit-note-title"
  tabindex="-1"
  bind:this={dialog}
  use:focusDialog
>
  <h2 id="edit-note-title">Edit note</h2>
  {#if message !== ''}
    <p role="alert">{message}</p>
  {/if}
  {#each fields as field, index (index)}
    <label for={`note-field-${index}`}>Field {index + 1}</label>
    <textarea
      id={`note-field-${index}`}
      rows="3"
      maxlength="50000"
      value={field}
      oninput={(event) => setField(index, event)}></textarea>
  {/each}
  <button type="button" disabled={busy} onclick={onClose}>Cancel</button>
  <button type="button" disabled={busy || fields.length === 0} onclick={() => void save()}>
    Save
  </button>
</div>
