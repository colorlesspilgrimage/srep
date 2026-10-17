<script lang="ts">
  import GalleryShell from '../../lib/client/tui/GalleryShell.svelte';
  import TuiPage from '#lib/client/app/TuiPage.svelte';
  import type { PageData } from './$types';

  // Contract: the signed-in gallery route. Guests stay on the auth pages.

  let { data }: { data: PageData } = $props();
</script>

<TuiPage />
<svelte:head><title>srep gallery</title></svelte:head>

<GalleryShell themeId={data.themeId} keybinds={data.keybinds} />
