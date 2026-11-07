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
  import { closeHint, openHint, paletteKeyAction, type KeybindMap } from '../tui/keymap.js';
  import { targetIsTextField } from '../tui/text-target.js';
  import { themeClass } from '../tui/themes.js';
  import { page } from '$app/state';
  import AppIcon from './AppIcon.svelte';
  import { APP_COMMANDS, commandTarget, NAV_ITEMS, tabKeyIndex, type NavPath } from './app-nav.js';
  import { DEFAULT_DISPLAY, displayRootClass, type DisplayPrefs } from './display-prefs.js';

  // Contract: the signed-in app shell. The main pane is the children snippet.
  // Palette keys use the capture phase. keyCapture true ignores those keys.
  // A command goes only to a fixed path. Close returns focus to the prior element.
  // Display prefs paint on the root in the first HTML (no FOUC).

  type Props = {
    themeId: string;
    keybinds: KeybindMap;
    display?: DisplayPrefs;
    children: Snippet;
    modalOpen?: boolean;
    keyCapture?: boolean;
    paletteOpen?: boolean;
    mode?: string;
  };

  let {
    themeId,
    keybinds,
    display = DEFAULT_DISPLAY,
    children,
    modalOpen = false,
    keyCapture = false,
    paletteOpen = $bindable(false),
    mode = 'DECKS',
  }: Props = $props();

  const pathNow = $derived(page.url.pathname);

  const hints = $derived([
    openHint(keybinds['palette.open']),
    closeHint(keybinds['palette.close']),
  ]);

  let returnFocus: HTMLElement | null = null;

  function rememberFocus(): void {
    const active = document.activeElement;
    returnFocus = active instanceof HTMLElement ? active : null;
  }

  function restoreFocus(): void {
    const node = returnFocus;
    returnFocus = null;
    if (node === null || !node.isConnected) {
      return;
    }
    queueMicrotask(() => {
      if (node.isConnected) {
        node.focus();
      }
    });
  }

  function onWindowKey(event: KeyboardEvent): void {
    if (keyCapture) {
      return;
    }
    const action = paletteKeyAction(event, {
      modalOpen,
      paletteOpen,
      binds: keybinds,
      targetIsField: targetIsTextField(event.target),
    });
    if (action === 'none') {
      return;
    }
    event.preventDefault();
    // Later capture listeners are on the same window. stopPropagation does not skip them.
    event.stopImmediatePropagation();
    if (action === 'open') {
      rememberFocus();
    }
    const wasOpen = paletteOpen;
    paletteOpen = action === 'open';
    if (wasOpen && action === 'close') {
      restoreFocus();
    }
  }

  function runCommand(name: string): void {
    const target = commandTarget(name);
    if (target === null) {
      return;
    }
    if (target === '/') {
      void goto(resolve('/'));
      return;
    }
    if (target === '/study') {
      void goto(resolve('/study'));
      return;
    }
    if (target === '/browse') {
      void goto(resolve('/browse'));
      return;
    }
    if (target === '/settings') {
      void goto(resolve('/settings'));
      return;
    }
    if (target === '/stats') {
      void goto(resolve('/stats'));
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

  function navTarget(href: NavPath): string {
    if (href === '/study') {
      return resolve('/study');
    }
    if (href === '/browse') {
      return resolve('/browse');
    }
    if (href === '/stats') {
      return resolve('/stats');
    }
    if (href === '/settings') {
      return resolve('/settings');
    }
    return resolve('/');
  }

  function openNav(href: NavPath): void {
    if (window.location.pathname === navTarget(href)) {
      return;
    }
    if (href === '/study') {
      void goto(resolve('/study'));
      return;
    }
    if (href === '/browse') {
      void goto(resolve('/browse'));
      return;
    }
    if (href === '/stats') {
      void goto(resolve('/stats'));
      return;
    }
    if (href === '/settings') {
      void goto(resolve('/settings'));
      return;
    }
    void goto(resolve('/'));
  }

  function closePalette(): void {
    paletteOpen = false;
    restoreFocus();
  }

  function onTabKey(event: KeyboardEvent): void {
    const tab = event.currentTarget;
    if (!(tab instanceof HTMLElement)) {
      return;
    }
    const list = tab.closest('[role="tablist"]');
    if (!(list instanceof HTMLElement)) {
      return;
    }
    const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
    const current = Math.max(0, tabs.indexOf(tab));
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

<div class="tui-root app-root {themeClass(themeId)} {displayRootClass(display)}">
  <header class="app-topbar">
    <a class="app-brand" href={resolve('/')}>
      <AppIcon name="brand" size={18} />
      <span>srep</span>
    </a>
    <nav class="app-nav tui-only-desktop" aria-label="Primary">
      {#each NAV_ITEMS as item (item.id)}
        <button
          type="button"
          class="app-nav-item"
          aria-current={pathNow === navTarget(item.href) ? 'page' : undefined}
          onclick={() => openNav(item.href)}
        >
          <AppIcon name={item.icon} size={15} />
          <span>{item.label}</span>
        </button>
      {/each}
    </nav>
    <div class="app-topbar-tools tui-only-desktop">
      <a class="app-tool-link" href={resolve('/gallery')}
        ><AppIcon name="gallery" size={14} /><span>Gallery</span></a
      >
      <a class="app-tool-link" href={resolve('/security')}
        ><AppIcon name="security" size={14} /><span>Security</span></a
      >
    </div>
  </header>
  <div class="tui-tabbar" role="tablist" aria-label="App sections">
    {#each NAV_ITEMS as item (item.id)}
      <button
        type="button"
        class="app-tab"
        role="tab"
        aria-selected={pathNow === navTarget(item.href)}
        onclick={() => openNav(item.href)}
        onkeydown={onTabKey}
      >
        <AppIcon name={item.icon} size={15} />
        <span>{item.label}</span>
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
  <StatusLine {mode} {hints} />
</div>
