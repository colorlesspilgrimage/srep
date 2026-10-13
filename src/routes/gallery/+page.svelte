<script lang="ts">
  import GalleryShell from '../../lib/client/tui/GalleryShell.svelte';
  import type { PageData } from './$types';

  // Contract: the signed-in gallery route. Guests stay on the auth pages.
  // Svelte 5 rejects a class on svelte:body. This effect adds tui-page.

  let { data }: { data: PageData } = $props();

  $effect.pre(() => {
    document.body.classList.add('tui-page');
    return () => {
      document.body.classList.remove('tui-page');
    };
  });
</script>

<svelte:head><title>srep gallery</title></svelte:head>

<GalleryShell themeId={data.themeId} keybinds={data.keybinds} />
