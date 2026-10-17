<script lang="ts">
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import AppShell from '#lib/client/app/AppShell.svelte';
  import NoteEditor from '#lib/client/app/NoteEditor.svelte';
  import { isDeckUuid } from '#lib/client/app/deck-id.js';

  // Contract: the add-note route. Guests stay on the auth pages.
  // Svelte 5 rejects a class on svelte:body. This effect adds tui-page.
  // A deck query is used only when it is a UUID.

  let { data }: { data: PageData } = $props();
  let paletteOpen = $state(false);

  const initialDeckId = $derived.by(() => {
    const raw = page.url.searchParams.get('deck');
    if (raw === null || !isDeckUuid(raw)) {
      return null;
    }
    return raw;
  });

  $effect.pre(() => {
    document.body.classList.add('tui-page');
    return () => {
      document.body.classList.remove('tui-page');
    };
  });
</script>

<svelte:head><title>Add note</title></svelte:head>

<AppShell themeId={data.themeId} keybinds={data.keybinds} bind:paletteOpen mode="NOTE">
  <NoteEditor mode="new" noteId={null} {initialDeckId} />
</AppShell>
