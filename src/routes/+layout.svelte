<script lang="ts">
  import type { Snippet } from 'svelte';
  import { setCsrfToken } from '#lib/client/api.js';
  import '#lib/client/tui/tui.css';
  import '#lib/client/tui/themes.css';

  let { children, data }: { children: Snippet; data: { csrfToken: string | null } } = $props();

  // Runs before the page code, so a page always sees the current token.
  $effect.pre(() => {
    setCsrfToken(data.csrfToken);
  });
</script>

<div class="auth-shell">
  {@render children()}
</div>

<style>
  :global(html),
  :global(body) {
    margin: 0;
    padding: 0;
    min-height: 100%;
    background: #0a0a0a;
    color: #ffffff;
  }

  :global(.app-root) {
    display: contents;
  }

  .auth-shell:not(:has(.tui-root)) {
    font-family: Inter, system-ui, sans-serif;
    font-weight: 400;
    line-height: 1.5;
    letter-spacing: -0.01em;
    margin: 0 auto;
    max-width: 28rem;
    padding: 3rem 1.25rem;
    min-height: 100dvh;
    box-sizing: border-box;
  }

  .auth-shell:not(:has(.tui-root)) :global(h1) {
    font-family: 'Inter Display', Inter, system-ui, sans-serif;
    font-weight: 400;
    font-size: clamp(2rem, 6vw, 2.75rem);
    letter-spacing: -0.04em;
    line-height: 1.1;
    margin: 0 0 1.25rem;
  }

  .auth-shell:not(:has(.tui-root)) :global(.error) {
    color: #f87171;
  }

  .auth-shell:not(:has(.tui-root)) :global(.field) {
    display: block;
    margin: 0.75rem 0;
  }

  .auth-shell:not(:has(.tui-root)) :global(.field input[type='text']),
  .auth-shell:not(:has(.tui-root)) :global(.field input[type='password']) {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 0.65rem 1rem;
    font: inherit;
    color: #ffffff;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 9999px;
  }

  .auth-shell:not(:has(.tui-root)) :global(button) {
    font: inherit;
    font-weight: 400;
    color: #ffffff;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 9999px;
    padding: 0.65rem 1.1rem;
    margin: 0 0.4rem 0.4rem 0;
    cursor: pointer;
  }

  .auth-shell:not(:has(.tui-root)) :global(button:hover) {
    background: #1a1a1a;
  }

  .auth-shell:not(:has(.tui-root)) :global(button:focus-visible),
  .auth-shell:not(:has(.tui-root)) :global(input:focus-visible) {
    outline: 2px solid #ffffff;
    outline-offset: 2px;
  }
</style>
