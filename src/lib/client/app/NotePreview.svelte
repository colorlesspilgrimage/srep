<script lang="ts">
  import CardHtml from '#lib/client/card/CardHtml.svelte';
  import type { PreviewCardView } from './note-editor-parse.js';

  // Contract: the live card preview.
  // CardHtml sanitizes each front and each back before display.
  // The region is polite. A second sanitize would escape a media image.

  let { cards }: { cards: readonly PreviewCardView[] } = $props();
</script>

<div class="note-preview" aria-live="polite">
  {#each cards as card (`${card.ordinal}:${card.templateName}`)}
    <p>{card.templateName}</p>
    <CardHtml text={card.front} />
    <CardHtml text={card.back} />
  {/each}
</div>
