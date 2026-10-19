<script lang="ts">
  import type { PageData } from './$types';
  import AppShell from '#lib/client/app/AppShell.svelte';
  import BrowseScreen from '#lib/client/app/BrowseScreen.svelte';
  import TuiPage from '#lib/client/app/TuiPage.svelte';

  // Contract: the signed-in browse route. Guests stay on the auth pages.
  // TuiPage adds tui-page in $effect.pre.

  let { data }: { data: PageData } = $props();
  let paletteOpen = $state(false);
  let modalOpen = $state(false);
</script>

<TuiPage />
<svelte:head><title>Browse</title></svelte:head>

<AppShell
  themeId={data.themeId}
  keybinds={data.keybinds}
  bind:paletteOpen
  {modalOpen}
  mode="BROWSE"
>
  <BrowseScreen {paletteOpen} bind:modalOpen />
</AppShell>
