<script lang="ts">
  // Contract: the status line shows the mode and the hints.

  type Props = { mode: string; hints: readonly string[] };

  let { mode, hints }: Props = $props();

  const text = $derived(hints.length === 0 ? mode : `${mode} | ${hints.join(' | ')}`);
</script>

<footer class="tui-status" aria-label="Status line">{text}</footer>
