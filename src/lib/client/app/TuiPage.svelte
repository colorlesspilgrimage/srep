<script lang="ts">
  // Svelte 5 rejects a class on svelte:body. This effect adds tui-page.
  $effect.pre(() => {
    document.body.classList.add('tui-page');
    return () => {
      document.body.classList.remove('tui-page');
    };
  });
</script>
