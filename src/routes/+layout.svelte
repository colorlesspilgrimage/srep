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
    background-image: radial-gradient(
      120% 80% at 50% -10%,
      rgba(255, 255, 255, 0.06),
      transparent 55%
    );
  }

  .auth-shell:not(:has(.tui-root)) :global(.auth-brand) {
    font-family: 'Inter Display', Inter, system-ui, sans-serif;
    font-size: 1.15rem;
    letter-spacing: -0.04em;
    margin: 0 0 1.75rem;
  }

  .auth-shell:not(:has(.tui-root)) :global(.auth-eyebrow) {
    font-family: 'Geist Mono', ui-monospace, monospace;
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #a3a3a3;
    margin: 0 0 0.65rem;
  }

  .auth-shell:not(:has(.tui-root)) :global(.auth-lead) {
    color: rgba(255, 255, 255, 0.5);
    margin: 0 0 1.5rem;
    line-height: 1.55;
  }

  .auth-shell:not(:has(.tui-root)) :global(.auth-actions) {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
    margin: 0 0 1.25rem;
  }

  .auth-shell:not(:has(.tui-root)) :global(.auth-primary) {
    background: #ffffff !important;
    color: #0a0a0a !important;
    border-color: #ffffff !important;
  }

  .auth-shell:not(:has(.tui-root)) :global(.auth-details) {
    margin-top: 1.5rem;
    color: #a3a3a3;
  }

  .auth-shell:not(:has(.tui-root)) :global(.auth-fieldset) {
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.75rem;
    padding: 0.75rem 1rem;
    margin: 1rem 0;
  }

  .auth-shell:not(:has(.tui-root)) :global(.auth-codes) {
    background: #191919;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.75rem;
    padding: 1rem;
    overflow: auto;
    font-family: 'Geist Mono', ui-monospace, monospace;
    font-size: 0.85rem;
  }

  .auth-shell:not(:has(.tui-root)) :global(h1) {
    font-family: 'Inter Display', Inter, system-ui, sans-serif;
    font-weight: 400;
    font-size: clamp(2rem, 6vw, 2.75rem);
    letter-spacing: -0.04em;
    line-height: 1.1;
    margin: 0 0 0.75rem;
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
