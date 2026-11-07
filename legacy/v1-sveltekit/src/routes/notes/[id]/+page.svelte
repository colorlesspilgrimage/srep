<script lang="ts">
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import AppShell from '#lib/client/app/AppShell.svelte';
  import NoteEditor from '#lib/client/app/NoteEditor.svelte';
  import TuiPage from '#lib/client/app/TuiPage.svelte';
  import { isDeckUuid } from '#lib/client/app/deck-id.js';

  let { data }: { data: PageData } = $props();
  let paletteOpen = $state(false);
  const noteId = $derived(page.params.id ?? '');
  const valid = $derived(isDeckUuid(noteId));
</script>

<TuiPage />
<svelte:head><title>Edit note</title></svelte:head>

<AppShell
  themeId={data.themeId}
  keybinds={data.keybinds}
  display={data.display}
  bind:paletteOpen
  mode="NOTE"
>
  {#if valid}
    {#key noteId}
      <NoteEditor mode="edit" {noteId} initialDeckId={null} />
    {/key}
  {:else}
    <main class="app-screen">
      <h1>Edit note</h1>
      <p role="alert">That note id is not valid.</p>
    </main>
  {/if}
</AppShell>
