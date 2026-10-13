<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { signOut } from '#lib/client/ceremonies.js';

  async function logOut(): Promise<void> {
    await signOut(false);
    await goto(resolve('/login'), { invalidateAll: true });
  }
</script>

<svelte:head><title>srep</title></svelte:head>
<main>
  <h1>srep</h1>
  <p>
    <a href={resolve('/security')}>Security</a>
    <a href={resolve('/gallery')}>Gallery</a>
  </p>
  <button type="button" onclick={logOut}>Log out</button>
</main>
