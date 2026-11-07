<script lang="ts">
  import type { PageData } from './$types';
  import AppShell from '#lib/client/app/AppShell.svelte';
  import StatsScreen from '#lib/client/app/StatsScreen.svelte';
  import TuiPage from '#lib/client/app/TuiPage.svelte';

  let { data }: { data: PageData } = $props();
  let paletteOpen = $state(false);
</script>

<TuiPage />
<svelte:head><title>Stats</title></svelte:head>

<AppShell
  themeId={data.themeId}
  keybinds={data.keybinds}
  display={data.display}
  bind:paletteOpen
  mode="STATS"
>
  <StatsScreen />
</AppShell>
