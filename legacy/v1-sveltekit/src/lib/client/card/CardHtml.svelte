<script lang="ts">
  import { sanitizeCardHtml } from './sanitize-card.js';

  let { text }: { text: string } = $props();
  const safe = $derived(sanitizeCardHtml(text));
</script>

<!-- sanitizeCardHtml escaped every other tag before this assignment (CWE-79). -->
<!-- eslint-disable-next-line svelte/no-at-html-tags -->
<div class="study-card">{@html safe}</div>
