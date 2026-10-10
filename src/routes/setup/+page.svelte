<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { enroll, type Kind } from '#lib/client/ceremonies.js';

  let setupToken = $state('');
  let nickname = $state('');
  let kind = $state<Kind>('passkey');
  let busy = $state(false);
  let error = $state('');
  let recoveryCodes = $state<string[]>([]);

  async function create(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    busy = true;
    error = '';
    const result = await enroll<{ recoveryCodes: string[] }>('/api/auth/setup', {
      kind,
      nickname,
      setupToken,
    });
    busy = false;
    setupToken = '';
    if (result.ok) {
      recoveryCodes = result.body.recoveryCodes;
    } else {
      error = result.message;
    }
  }
</script>

<svelte:head><title>srep setup</title></svelte:head>
<main>
  <h1>Set up srep</h1>
  {#if recoveryCodes.length === 0}
    <form onsubmit={create}>
      <label class="field">
        Setup token
        <input type="password" autocomplete="off" required bind:value={setupToken} />
      </label>
      <label class="field">
        Nickname
        <input type="text" autocomplete="off" required maxlength="64" bind:value={nickname} />
      </label>
      <fieldset>
        <legend>Credential type</legend>
        <label><input type="radio" name="kind" value="passkey" bind:group={kind} /> Passkey</label>
        <label
          ><input type="radio" name="kind" value="security_key" bind:group={kind} /> Security key</label
        >
      </fieldset>
      <p>
        <button type="submit" disabled={busy}>Create</button>
      </p>
    </form>
    {#if error !== ''}<p class="error" role="alert">{error}</p>{/if}
  {:else}
    <p role="status">Save these codes now. They are shown once.</p>
    <pre aria-label="Recovery codes">{recoveryCodes.join('\n')}</pre>
    <p>Add a second credential on the security page, so you cannot lose access.</p>
    <button type="button" onclick={() => goto(resolve('/security'), { invalidateAll: true })}>
      Continue
    </button>
  {/if}
</main>
