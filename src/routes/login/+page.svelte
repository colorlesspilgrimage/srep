<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { apiFetch, setCsrfToken } from '#lib/client/api.js';
  import { loginWith, type Kind } from '#lib/client/ceremonies.js';
  import { messageFor } from '#lib/client/messages.js';

  let busy = $state(false);
  let error = $state('');
  let code = $state('');

  async function login(kind: Kind): Promise<void> {
    busy = true;
    error = '';
    const result = await loginWith(kind);
    busy = false;
    if (result.ok) {
      await goto(resolve('/'), { invalidateAll: true });
    } else {
      error = result.message;
    }
  }

  async function useRecoveryCode(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    busy = true;
    error = '';
    const result = await apiFetch<{ csrfToken: string }>('/api/auth/recovery/login', {
      method: 'POST',
      body: { code },
    });
    busy = false;
    code = '';
    if (result.ok) {
      setCsrfToken(result.body.csrfToken);
      await goto(resolve('/'), { invalidateAll: true });
    } else {
      error = messageFor(result.error);
    }
  }
</script>

<svelte:head><title>srep login</title></svelte:head>
<main>
  <h1>Log in</h1>
  <p>
    <button type="button" disabled={busy} onclick={() => login('passkey')}>
      Log in with a passkey
    </button>
    <button type="button" disabled={busy} onclick={() => login('security_key')}>
      Log in with a security key
    </button>
  </p>
  {#if error !== ''}<p class="error" role="alert">{error}</p>{/if}
  <details>
    <summary>Use a recovery code</summary>
    <form onsubmit={useRecoveryCode}>
      <label class="field">
        Recovery code
        <input type="text" autocomplete="off" required maxlength="64" bind:value={code} />
      </label>
      <button type="submit" disabled={busy}>Log in with code</button>
    </form>
  </details>
</main>
