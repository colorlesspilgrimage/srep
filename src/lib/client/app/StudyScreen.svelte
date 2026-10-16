<script lang="ts">
  import { browser } from '$app/env';
  import { page } from '$app/state';
  import { onMount, untrack } from 'svelte';
  import CardHtml from '#lib/client/card/CardHtml.svelte';
  import { targetIsTextField } from '#lib/client/tui/text-target.js';
  import EditCardDialog from './EditCardDialog.svelte';
  import {
    applyNext,
    applySaveResult,
    badDeck,
    beginAction,
    closeEdit,
    failedAction,
    failedLoad,
    initialStudyState,
    mutationFollowUp,
    nothingToUndo,
    openEdit,
    phaseSide,
    phaseStatus,
    rateElapsed,
    rememberInterval,
    reveal,
  } from './study-state.js';
  import { createStudyClient } from './study-client.js';
  import { parseNextReply, readAnswerInterval } from './study-parse.js';
  import { STUDY_RATINGS, studyKeyAction, type StudyRating } from './study-keys.js';
  import { studyNextPath } from './study-paths.js';

  // Contract: the study screen. It reads deck from the query.
  // A bad deck id shows an error and does not call the API.
  // One rate, undo, or suspend runs at a time. An open edit blocks them.
  // A reply from an older load is not applied. CardHtml is the only renderer.

  type Props = { paletteOpen: boolean };

  let { paletteOpen }: Props = $props();
  const client = createStudyClient();

  let screen = $state(initialStudyState());
  let deckParam: string | null = null;
  let generation = 0;

  const RATE_NAMES: Record<StudyRating, string> = {
    1: 'Again',
    2: 'Hard',
    3: 'Good',
    4: 'Easy',
  };

  function rateButtonText(rating: StudyRating, interval: string): string {
    return `${RATE_NAMES[rating]} ${interval}`;
  }

  function countsOf(): { new: number; learning: number; review: number } | null {
    const phase = screen.phase;
    if (phase.kind === 'card' || phase.kind === 'wait' || phase.kind === 'done') {
      return phase.counts;
    }
    return null;
  }

  async function loadDeck(param: string | null): Promise<void> {
    const gen = ++generation;
    if (param !== null && studyNextPath(param) === null) {
      screen = badDeck(screen);
      return;
    }
    screen = { ...screen, busy: true, message: '', phase: { kind: 'loading' } };
    const result = await client.next(param);
    if (gen !== generation) {
      return;
    }
    if (!result.ok) {
      screen = failedLoad(screen, result.error);
      return;
    }
    const reply = parseNextReply(result.body);
    if (reply === null) {
      screen = failedLoad(screen, 'bad_request');
      return;
    }
    screen = applyNext(screen, reply, performance.now());
  }

  function takeAction(): number | null {
    const next = beginAction(screen);
    if (next === null) {
      return null;
    }
    const flight = generation;
    screen = next;
    return flight;
  }

  async function settle(flight: number, ok: boolean, onFail: () => void): Promise<boolean> {
    const plan = mutationFollowUp(flight, generation, ok);
    if (plan === 'drop') {
      return false;
    }
    if (plan === 'refresh') {
      await loadDeck(deckParam);
      return false;
    }
    if (!ok) {
      onFail();
      return false;
    }
    return true;
  }

  async function rate(rating: StudyRating): Promise<void> {
    if (screen.phase.kind !== 'card') {
      return;
    }
    const card = screen.phase.card;
    const elapsed = rateElapsed(screen, performance.now());
    const flight = takeAction();
    if (flight === null) {
      return;
    }
    const result = await client.answer({
      cardId: card.id,
      rating,
      reps: card.reps,
      elapsedMs: elapsed,
    });
    if (!result.ok && result.status === 409) {
      if (mutationFollowUp(flight, generation, false) !== 'drop') {
        await loadDeck(deckParam);
      }
      return;
    }
    const apply = await settle(flight, result.ok, () => {
      if (!result.ok) {
        screen = failedAction(screen, result.error);
      }
    });
    if (!apply || !result.ok) {
      return;
    }
    screen = rememberInterval(screen, readAnswerInterval(result.body));
    await loadDeck(deckParam);
  }

  async function undo(): Promise<void> {
    const flight = takeAction();
    if (flight === null) {
      return;
    }
    const result = await client.undo();
    const apply = await settle(flight, result.ok, () => {
      if (!result.ok) {
        screen = result.status === 404 ? nothingToUndo(screen) : failedAction(screen, result.error);
      }
    });
    if (apply) {
      await loadDeck(deckParam);
    }
  }

  async function suspend(): Promise<void> {
    if (screen.phase.kind !== 'card') {
      return;
    }
    const cardId = screen.phase.card.id;
    const flight = takeAction();
    if (flight === null) {
      return;
    }
    const result = await client.suspend(cardId);
    const apply = await settle(flight, result.ok, () => {
      if (!result.ok) {
        screen = failedAction(screen, result.error);
      }
    });
    if (apply) {
      await loadDeck(deckParam);
    }
  }

  function onSaved(cardId: string, text: { front: string; back: string } | null): void {
    const decision = applySaveResult(screen, cardId, text);
    if (decision.kind === 'ignore') {
      return;
    }
    screen = decision.state;
    if (decision.kind === 'reload') {
      void loadDeck(deckParam);
    }
  }

  function targetIsButton(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && target.tagName === 'BUTTON';
  }

  function onKey(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const action = studyKeyAction({
      key: event.key,
      side: phaseSide(screen.phase),
      targetIsField: targetIsTextField(event.target),
      targetIsButton: targetIsButton(event.target),
      modalOpen: screen.editOpen,
      paletteOpen,
      status: phaseStatus(screen.phase),
      inFlight: screen.busy,
    });
    if (action.type === 'none') {
      return;
    }
    event.preventDefault();
    if (action.type === 'reveal') {
      screen = reveal(screen);
      return;
    }
    if (action.type === 'rate') {
      void rate(action.rating);
      return;
    }
    if (action.type === 'undo') {
      void undo();
      return;
    }
    if (action.type === 'suspend') {
      void suspend();
      return;
    }
    screen = openEdit(screen);
  }

  $effect(() => {
    if (!browser) {
      return;
    }
    const param = page.url.searchParams.get('deck');
    deckParam = param;
    untrack(() => {
      void loadDeck(param);
    });
  });

  onMount(() => {
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  });

  const counts = $derived(countsOf());
  const locked = $derived(screen.busy || screen.editOpen);
</script>

{#snippet undoButton()}
  <button type="button" disabled={locked} onclick={() => void undo()}>Undo</button>
{/snippet}

<main class="app-screen">
  <h1>Study</h1>
  {#if screen.message !== ''}
    <p role="alert">{screen.message}</p>
  {/if}
  {#if screen.phase.kind === 'bad-deck'}
    <p role="alert">That deck id is not valid.</p>
  {:else if screen.phase.kind === 'loading'}
    <p>Loading.</p>
  {:else if screen.phase.kind === 'error'}
    <p role="alert">{screen.phase.message}</p>
  {:else if counts !== null}
    <p class="study-progress">New {counts.new} Learning {counts.learning} Due {counts.review}</p>
    {#if screen.phase.kind === 'card'}
      <CardHtml
        text={screen.phase.side === 'front' ? screen.phase.card.front : screen.phase.card.back}
      />
      {#if screen.phase.side === 'front'}
        <button type="button" disabled={locked} onclick={() => (screen = reveal(screen))}>
          Reveal
        </button>
      {:else}
        <div class="study-rate">
          {#each STUDY_RATINGS as rating (rating)}
            <button type="button" disabled={locked} onclick={() => void rate(rating)}>
              {rateButtonText(rating, screen.phase.card.labels[rating])}
            </button>
          {/each}
        </div>
      {/if}
      {@render undoButton()}
      <button type="button" disabled={locked} onclick={() => void suspend()}>Suspend</button>
      <button type="button" disabled={locked} onclick={() => (screen = openEdit(screen))}>
        Edit
      </button>
    {:else if screen.phase.kind === 'wait'}
      <p>Next card at {screen.phase.untilText}</p>
      {@render undoButton()}
    {:else}
      <p>No cards left.</p>
      <p>Next due in {screen.phase.dueText}</p>
      {@render undoButton()}
    {/if}
  {/if}
</main>
{#if screen.editOpen && screen.phase.kind === 'card'}
  <EditCardDialog
    noteId={screen.phase.card.noteId}
    cardId={screen.phase.card.id}
    onClose={() => (screen = closeEdit(screen))}
    {onSaved}
  />
{/if}
