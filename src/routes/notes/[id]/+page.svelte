<script lang="ts">
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import AppShell from '#lib/client/app/AppShell.svelte';
  import NoteEditor from '#lib/client/app/NoteEditor.svelte';
  import { isDeckUuid } from '#lib/client/app/deck-id.js';

  // Contract: the edit-note route. Guests stay on the auth pages.
  // Svelte 5 rejects a class on svelte:body. This effect adds tui-page.
  // A bad id renders the error and does not call GET /api/notes/:id.

  let { data }: { data: PageData } = $props();
  let paletteOpen = $state(false);
  const noteId = $derived(page.params.id ?? '');
  const valid = $derived(isDeckUuid(noteId));

  $effect.pre(() => {
    document.body.classList.add('tui-page');
    return () => {
      document.body.classList.remove('tui-page');
    };
  });
</script>

<svelte:head><title>Edit note</title></svelte:head>

<AppShell themeId={data.themeId} keybinds={data.keybinds} bind:paletteOpen mode="NOTE">
  {#if valid}
    <NoteEditor mode="edit" {noteId} initialDeckId={null} />
  {:else}
    <main class="app-screen">
      <h1>Edit note</h1>
      <p role="alert">That note id is not valid.</p>
    </main>
  {/if}
</AppShell>
