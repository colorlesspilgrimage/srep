<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { Snippet } from 'svelte';
  import '../tui/tui.css';
  import '../tui/themes.css';
  import './app.css';
  import CommandPalette from '../tui/CommandPalette.svelte';
  import StatusLine from '../tui/StatusLine.svelte';
  import {
    closeHint,
    elementIsTextField,
    openHint,
    paletteKeyAction,
    type KeybindMap,
  } from '../tui/keymap.js';
  import { themeClass } from '../tui/themes.js';
  import { APP_COMMANDS, commandTarget, NAV_ITEMS, tabKeyIndex } from './app-nav.js';

  // Contract: the signed-in app shell. The main pane is the children snippet.
  // The theme class sits on tui-root. The tab bar uses tui-tabbar.
  // Palette keys match the gallery: capture phase on window.
  // keyCapture true ignores those keys. A fixed command path is the only navigation.

  type Props = {
    themeId: string;
    keybinds: KeybindMap;
    children: Snippet;
    modalOpen?: boolean;
    keyCapture?: boolean;
    paletteOpen?: boolean;
  };

  let {
    themeId,
    keybinds,
    children,
    modalOpen = false,
    keyCapture = false,
    paletteOpen = $bindable(false),
  }: Props = $props();

  const hints = $derived([
    openHint(keybinds['palette.open']),
    closeHint(keybinds['palette.close']),
  ]);

  function isField(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return elementIsTextField(target.tagName, target.isContentEditable);
  }

  function onWindowKey(event: KeyboardEvent): void {
    if (keyCapture) {
      return;
    }
    const action = paletteKeyAction(event, {
      modalOpen,
      paletteOpen,
      binds: keybinds,
      targetIsField: isField(event.target),
    });
    if (action === 'none') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    paletteOpen = action === 'open';
  }

  function runCommand(name: string): void {
    const target = commandTarget(name);
    if (target === '/') {
      void goto(resolve('/'));
      return;
    }
    if (target === '/gallery') {
      void goto(resolve('/gallery'));
      return;
    }
    if (target === '/security') {
      void goto(resolve('/security'));
    }
  }

  function closePalette(): void {
    paletteOpen = false;
  }

  function openDecks(): void {
    void goto(resolve('/'));
  }

  function onTabKey(event: KeyboardEvent): void {
    const list = event.currentTarget;
    if (!(list instanceof HTMLElement)) {
      return;
    }
    const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
    const current = Math.max(0, tabs.indexOf(document.activeElement as HTMLElement));
    const next = tabKeyIndex(tabs.length, current, event.key);
    if (next === null) {
      return;
    }
    event.preventDefault();
    tabs[next]?.focus();
  }

  onMount(() => {
    window.addEventListener('keydown', onWindowKey, true);
    return () => {
      window.removeEventListener('keydown', onWindowKey, true);
    };
  });
</script>

<div class="tui-root app-root {themeClass(themeId)}">
  <div class="tui-tabbar" role="tablist" aria-label="App sections" onkeydown={onTabKey}>
    {#each NAV_ITEMS as item (item.id)}
      <button type="button" class="app-tab" role="tab" aria-selected="true" onclick={openDecks}>
        {item.label}
      </button>
    {/each}
  </div>
  {@render children()}
  <CommandPalette
    open={paletteOpen}
    commands={APP_COMMANDS}
    onClose={closePalette}
    onRun={runCommand}
  />
  <StatusLine mode="DECKS" {hints} />
</div>
