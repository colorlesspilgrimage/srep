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

<div class="tui-frame" role="group">
  <div class="tui-frame-line tui-only-desktop" aria-hidden="true">{desktopTop}</div>
  <div class="tui-frame-line tui-only-mobile" aria-hidden="true">{mobileTop}</div>
  <div class="tui-frame-row">
    <span class="tui-frame-bar tui-only-desktop" aria-hidden="true">{VERTICAL}</span>
    <span class="tui-frame-bar tui-only-mobile" aria-hidden="true">{VERTICAL}</span>
    <div class="tui-frame-slot">{@render children()}</div>
    <span class="tui-frame-bar tui-only-desktop" aria-hidden="true">{VERTICAL}</span>
    <span class="tui-frame-bar tui-only-mobile" aria-hidden="true">{VERTICAL}</span>
  </div>
  <div class="tui-frame-line tui-only-desktop" aria-hidden="true">{desktopBottom}</div>
  <div class="tui-frame-line tui-only-mobile" aria-hidden="true">{mobileBottom}</div>
</div>
