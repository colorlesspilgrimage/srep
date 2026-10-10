<script lang="ts">
  import type { Snippet } from 'svelte';
  import { setCsrfToken } from '#lib/client/api.js';

  let { children, data }: { children: Snippet; data: { csrfToken: string | null } } = $props();

  // Runs before the page code, so a page always sees the current token.
  $effect.pre(() => {
    setCsrfToken(data.csrfToken);
  });
</script>

{@render children()}

<style>
  :global(.app-root) {
    display: contents;
  }
  :global(body) {
    font-family: system-ui, sans-serif;
    line-height: 1.5;
    margin: 0 auto;
    max-width: 40rem;
    padding: 1rem;
  }
  :global(.error) {
    color: #b00020;
  }
  :global(.field) {
    display: block;
    margin: 0.75rem 0;
  }
  :global(.field input[type='text']),
  :global(.field input[type='password']) {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 0.4rem;
  }
  :global(button) {
    padding: 0.4rem 0.8rem;
    margin-right: 0.4rem;
  }
</style>
