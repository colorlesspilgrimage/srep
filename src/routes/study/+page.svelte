<script lang="ts">
  import type { PageData } from './$types';
  import AppShell from '#lib/client/app/AppShell.svelte';
  import StudyScreen from '#lib/client/app/StudyScreen.svelte';
  import TuiPage from '#lib/client/app/TuiPage.svelte';

  // Contract: the signed-in study route. Guests stay on the auth pages.

  let { data }: { data: PageData } = $props();
  let paletteOpen = $state(false);
</script>

<TuiPage />
<svelte:head><title>Study</title></svelte:head>

<AppShell themeId={data.themeId} keybinds={data.keybinds} bind:paletteOpen mode="STUDY">
  <StudyScreen {paletteOpen} />
</AppShell>
