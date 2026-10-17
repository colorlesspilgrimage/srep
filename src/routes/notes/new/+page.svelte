<script lang="ts">
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import AppShell from '#lib/client/app/AppShell.svelte';
  import NoteEditor from '#lib/client/app/NoteEditor.svelte';
  import TuiPage from '#lib/client/app/TuiPage.svelte';
  import { isDeckUuid } from '#lib/client/app/deck-id.js';

  // Contract: the add-note route. Guests stay on the auth pages.
  // A deck query is used only when it is a UUID.
  // A new deck id mounts a new editor. The old editor drops a late reply.

  let { data }: { data: PageData } = $props();
  let paletteOpen = $state(false);

  const initialDeckId = $derived.by(() => {
    const raw = page.url.searchParams.get('deck');
    if (raw === null || !isDeckUuid(raw)) {
      return null;
    }
    return raw;
  });
</script>

<TuiPage />
<svelte:head><title>Add note</title></svelte:head>

<AppShell themeId={data.themeId} keybinds={data.keybinds} bind:paletteOpen mode="NOTE">
  {#key initialDeckId ?? ''}
    <NoteEditor mode="new" noteId={null} {initialDeckId} />
  {/key}
</AppShell>
