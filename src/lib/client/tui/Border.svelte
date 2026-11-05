<script lang="ts">
  import type { Snippet } from 'svelte';

  // Contract: a surface panel with an optional eyebrow title. No box-drawing.

  type Props = { title: string; children: Snippet };

  let { title, children }: Props = $props();
</script>

<div class="tui-frame" role="group">
  {#if title !== ''}
    <p class="tui-frame-title">{title}</p>
  {/if}
  <div class="tui-frame-slot">{@render children()}</div>
</div>
