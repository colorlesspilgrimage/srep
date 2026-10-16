<script lang="ts">
  import type { PageData } from './$types';
  import AppShell from '#lib/client/app/AppShell.svelte';
  import StudyScreen from '#lib/client/app/StudyScreen.svelte';

  // Contract: the signed-in study route. Guests stay on the auth pages.
  // Svelte 5 rejects a class on svelte:body. This effect adds tui-page.

  let { data }: { data: PageData } = $props();
  let paletteOpen = $state(false);

  $effect.pre(() => {
    document.body.classList.add('tui-page');
    return () => {
      document.body.classList.remove('tui-page');
    };
  });
</script>

<svelte:head><title>Study</title></svelte:head>

<AppShell themeId={data.themeId} keybinds={data.keybinds} bind:paletteOpen mode="STUDY">
  <StudyScreen {paletteOpen} />
</AppShell>
