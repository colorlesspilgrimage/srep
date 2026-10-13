<script lang="ts">
  import { acceptFormValue, FORM_VALUE_MAX, formIdsOk } from './form-value.js';

  // Contract: one text field. An empty value does not call onSubmit.
  // A value longer than 80 characters does not call onSubmit.

  type Props = {
    idPrefix: string;
    name: string;
    onSubmit: (value: string) => void;
  };

  let { idPrefix, name, onSubmit }: Props = $props();

  let value = $state('');
  let error = $state('');

  const fieldsOk = $derived(formIdsOk(idPrefix, name));
  const inputId = $derived(`tui-form-${idPrefix}-${name}`);
  const errorId = $derived(`${inputId}-error`);

  function submitForm(event: SubmitEvent): void {
    event.preventDefault();
    const result = acceptFormValue(value);
    if (!result.ok) {
      error = result.error;
      return;
    }
    error = '';
    onSubmit(result.value);
  }
</script>

{#if fieldsOk}
  <form class="tui-form" method="post" onsubmit={submitForm}>
    <label for={inputId}>Value</label>
    <input
      id={inputId}
      type="text"
      {name}
      maxlength={FORM_VALUE_MAX}
      autocomplete="off"
      bind:value
      aria-invalid={error !== ''}
      aria-describedby={error === '' ? undefined : errorId}
    />
    {#if error !== ''}
      <p id={errorId} role="alert">{error}</p>
    {/if}
    <button type="submit">Submit</button>
  </form>
{/if}
