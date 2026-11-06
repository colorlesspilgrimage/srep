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
    background: #0c0f14;
    color: #f4f7fb;
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
    background-color: #0c0f14;
    background-image:
      radial-gradient(90% 70% at 12% -10%, rgba(45, 212, 191, 0.16), transparent 45%),
      radial-gradient(80% 60% at 90% 0%, rgba(96, 165, 250, 0.1), transparent 40%);
  }

  .auth-shell:not(:has(.tui-root)) :global(.auth-brand) {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font-family: 'Inter Display', Inter, system-ui, sans-serif;
    font-size: 1.15rem;
    letter-spacing: -0.04em;
    margin: 0 0 1.75rem;
  }

  .auth-shell:not(:has(.tui-root)) :global(.auth-brand .app-icon) {
    color: #2dd4bf;
  }

  .auth-shell:not(:has(.tui-root)) :global(.auth-eyebrow) {
    font-family: 'Geist Mono', ui-monospace, monospace;
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #9aa8b8;
    margin: 0 0 0.65rem;
  }

  .auth-shell:not(:has(.tui-root)) :global(.auth-lead) {
    color: rgba(244, 247, 251, 0.58);
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
    background: #2dd4bf !important;
    color: #042f2e !important;
    border-color: #2dd4bf !important;
  }

  .auth-shell:not(:has(.tui-root)) :global(.auth-details) {
    margin-top: 1.5rem;
    color: #9aa8b8;
  }

  .auth-shell:not(:has(.tui-root)) :global(.auth-fieldset) {
    border: 1px solid rgba(244, 247, 251, 0.1);
    border-radius: 0.75rem;
    padding: 0.75rem 1rem;
    margin: 1rem 0;
  }

  .auth-shell:not(:has(.tui-root)) :global(.auth-codes) {
    background: #151b24;
    border: 1px solid rgba(244, 247, 251, 0.1);
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
    color: #f4f7fb;
    background: #1c2430;
    border: 1px solid rgba(244, 247, 251, 0.1);
    border-radius: 0.55rem;
  }

  .auth-shell:not(:has(.tui-root)) :global(button) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    font: inherit;
    font-weight: 400;
    color: #f4f7fb;
    background: #1c2430;
    border: 1px solid rgba(244, 247, 251, 0.1);
    border-radius: 0.55rem;
    padding: 0.65rem 1.1rem;
    margin: 0 0.4rem 0.4rem 0;
    cursor: pointer;
  }

  .auth-shell:not(:has(.tui-root)) :global(button:hover) {
    background: #1a2330;
    border-color: rgba(244, 247, 251, 0.18);
  }

  .auth-shell:not(:has(.tui-root)) :global(button:focus-visible),
  .auth-shell:not(:has(.tui-root)) :global(input:focus-visible) {
    outline: 2px solid #2dd4bf;
    outline-offset: 2px;
  }
</style>
