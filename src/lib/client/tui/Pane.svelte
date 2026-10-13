<script lang="ts">
  import type { Snippet } from 'svelte';
  import Border from './Border.svelte';

  // Contract: a labelled section around one frame.

  type Props = { label: string; title: string; children: Snippet };

  let { label, title, children }: Props = $props();
</script>

<section aria-label={label}>
  <Border {title}>{@render children()}</Border>
</section>
