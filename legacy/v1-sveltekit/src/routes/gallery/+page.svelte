<script lang="ts">
  import GalleryShell from '../../lib/client/tui/GalleryShell.svelte';
  import TuiPage from '#lib/client/app/TuiPage.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<TuiPage />
<svelte:head><title>srep gallery</title></svelte:head>

<GalleryShell themeId={data.themeId} keybinds={data.keybinds} />
