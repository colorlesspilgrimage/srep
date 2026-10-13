<script lang="ts">
  import type { Snippet } from 'svelte';
  import { DESKTOP_COLUMNS, MOBILE_COLUMNS, fitTitle, frameBottom, frameTop } from './grid.js';

  // Contract: a box-drawing frame. Desktop and mobile lines share one tree.

  type Props = { title: string; children: Snippet };

  const VERTICAL = '\u2502';

  let { title, children }: Props = $props();

  const desktopTop = $derived(frameTop(DESKTOP_COLUMNS, fitTitle(title, DESKTOP_COLUMNS)));
  const mobileTop = $derived(frameTop(MOBILE_COLUMNS, fitTitle(title, MOBILE_COLUMNS)));
  const desktopBottom = $derived(frameBottom(DESKTOP_COLUMNS));
  const mobileBottom = $derived(frameBottom(MOBILE_COLUMNS));
</script>

{#snippet frameLine(mode: string, text: string)}
  <div class="tui-frame-line tui-only-{mode}" aria-hidden="true">{text}</div>
{/snippet}

{#snippet frameBar(mode: string)}
  <span class="tui-frame-bar tui-only-{mode}" aria-hidden="true">{VERTICAL}</span>
{/snippet}

<div class="tui-frame" role="group">
  {@render frameLine('desktop', desktopTop)}
  {@render frameLine('mobile', mobileTop)}
  <div class="tui-frame-row">
    {@render frameBar('desktop')}
    {@render frameBar('mobile')}
    <div class="tui-frame-slot">{@render children()}</div>
    {@render frameBar('desktop')}
    {@render frameBar('mobile')}
  </div>
  {@render frameLine('desktop', desktopBottom)}
  {@render frameLine('mobile', mobileBottom)}
</div>
