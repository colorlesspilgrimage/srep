<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '#lib/client/api.js';
  import { encodedUuid } from './deck-id.js';

  // Contract: trash list/restore + import/export stubs (M6). Lean: no extra client module.

  type TrashNote = { id: string; preview: string; deletedAt: number };

  let notes = $state<TrashNote[]>([]);
  let status = $state('');
  let pending = $state(false);
  let ready = $state(false);

  async function load(): Promise<void> {
    const result = await apiFetch<{ notes: TrashNote[] }>('/api/notes/trash');
    if (!result.ok) {
      status = 'Could not load the trash.';
      ready = true;
      return;
    }
    notes = result.body.notes;
    ready = true;
  }

  async function restore(id: string): Promise<void> {
    if (pending) {
      return;
    }
    const encoded = encodedUuid(id);
    if (encoded === null) {
      status = 'The request failed.';
      return;
    }
    pending = true;
    status = '';
    try {
      const result = await apiFetch(`/api/notes/${encoded}/restore`, { method: 'POST', body: {} });
      if (!result.ok) {
        status =
          result.error === 'deck_required'
            ? 'Pick a deck before restoring this note.'
            : 'The request failed.';
        return;
      }
      status = 'Restored.';
      await load();
    } finally {
      pending = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

{#if ready}
  <h2>Trash</h2>
  {#if notes.length === 0}
    <p role="status">Trash is empty.</p>
  {:else}
    <ul aria-label="Trashed notes">
      {#each notes as note (note.id)}
        <li>
          <span>{note.preview === '' ? '(empty)' : note.preview}</span>
          <button
            type="button"
            disabled={pending}
            aria-label={'Restore ' + (note.preview === '' ? note.id : note.preview)}
            onclick={() => restore(note.id)}>Restore</button
          >
        </li>
      {/each}
    </ul>
  {/if}
  {#if status !== ''}
    <p role="status" aria-label="Data status">{status}</p>
  {/if}
  <h2>Import / export</h2>
  <p>Anki import and export ship in M6.</p>
{:else}
  <p>Loading data…</p>
{/if}
