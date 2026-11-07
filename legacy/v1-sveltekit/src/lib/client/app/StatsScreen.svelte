<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '#lib/client/api.js';
  const DEFAULT_PRESET_ID = '00000000-0000-4000-8000-000000000001';

  type Today = { reviews: number; elapsedMs: number; again: number; good: number };
  type Streak = { current: number; longest: number };
  type Retention = {
    matureReviews: number;
    trueRetention: number | null;
    desiredRetention: number;
  };
  type HeatCell = { dayNumber: number; count: number };
  type ForecastDay = { dayNumber: number; due: number };

  let loading = $state(true);
  let status = $state('');
  let today = $state<Today | null>(null);
  let streak = $state<Streak | null>(null);
  let retention = $state<Retention | null>(null);
  let heatmap = $state<HeatCell[]>([]);
  let forecast = $state<ForecastDay[]>([]);
  let optimizerStatus = $state('');
  let previewToken = $state<string | null>(null);
  let proposedRetention = $state<number | null>(null);

  function fmtPct(value: number | null): string {
    if (value === null) {
      return '—';
    }
    return `${Math.round(value * 1000) / 10}%`;
  }

  function fmtMinutes(ms: number): string {
    return `${Math.round(ms / 60_000)}m`;
  }

  async function loadAll(): Promise<void> {
    loading = true;
    status = '';
    const [t, s, r, h, f] = await Promise.all([
      apiFetch<{ today: Today }>('/api/stats/today'),
      apiFetch<{ streak: Streak }>('/api/stats/streak'),
      apiFetch<{ retention: Retention }>('/api/stats/retention'),
      apiFetch<{ cells: HeatCell[] }>('/api/stats/heatmap?days=120'),
      apiFetch<{ days: ForecastDay[] }>('/api/stats/forecast?days=14'),
    ]);
    if (!t.ok || !s.ok || !r.ok || !h.ok || !f.ok) {
      status = 'Could not load stats.';
      loading = false;
      return;
    }
    today = t.body.today;
    streak = s.body.streak;
    retention = r.body.retention;
    heatmap = h.body.cells;
    forecast = f.body.days;
    loading = false;
  }

  async function previewOptimize(): Promise<void> {
    optimizerStatus = '';
    previewToken = null;
    proposedRetention = null;
    const result = await apiFetch<{
      previewToken: string;
      proposed: { desiredRetention: number };
      reviewCount: number;
    }>('/api/stats/optimizer/preview', {
      method: 'POST',
      body: { presetId: DEFAULT_PRESET_ID },
    });
    if (!result.ok) {
      optimizerStatus =
        result.error === 'insufficient_reviews'
          ? 'Need more review history before optimizing.'
          : 'Preview failed.';
      return;
    }
    previewToken = result.body.previewToken;
    proposedRetention = result.body.proposed.desiredRetention;
    optimizerStatus = `Preview ready (${result.body.reviewCount} reviews). Proposed retention ${fmtPct(proposedRetention)}.`;
  }

  async function applyOptimize(): Promise<void> {
    if (previewToken === null) {
      return;
    }
    const result = await apiFetch<{ presetId: string }>('/api/stats/optimizer/apply', {
      method: 'POST',
      body: { presetId: DEFAULT_PRESET_ID, previewToken },
    });
    if (!result.ok) {
      optimizerStatus = 'Apply failed.';
      return;
    }
    optimizerStatus = 'Preset updated.';
    previewToken = null;
    await loadAll();
  }

  onMount(() => {
    void loadAll();
  });
</script>

<section class="stats-screen" aria-labelledby="stats-heading">
  <h1 id="stats-heading" class="stats-title">Stats</h1>
  {#if status}
    <p class="stats-status" role="status">{status}</p>
  {/if}
  {#if loading}
    <p class="stats-status">Loading…</p>
  {:else}
    <div class="stats-grid">
      <article class="stats-card">
        <h2>Today</h2>
        {#if today}
          <p>{today.reviews} reviews · {fmtMinutes(today.elapsedMs)}</p>
          <p class="stats-muted">Again {today.again} · Good+ {today.good}</p>
        {/if}
      </article>
      <article class="stats-card">
        <h2>Streak</h2>
        {#if streak}
          <p>{streak.current} days (best {streak.longest})</p>
        {/if}
      </article>
      <article class="stats-card">
        <h2>Retention</h2>
        {#if retention}
          <p>True {fmtPct(retention.trueRetention)}</p>
          <p class="stats-muted">Target {fmtPct(retention.desiredRetention)}</p>
          <p class="stats-muted">{retention.matureReviews} mature reviews</p>
        {/if}
      </article>
    </div>

    <article class="stats-panel">
      <h2>Activity (120 days)</h2>
      <div class="stats-heatmap" role="img" aria-label="Review heatmap">
        {#each heatmap as cell (cell.dayNumber)}
          <span class="stats-heat" data-level={Math.min(4, cell.count)} title="{cell.count} reviews"
          ></span>
        {/each}
      </div>
    </article>

    <article class="stats-panel">
      <h2>Forecast (14 days)</h2>
      <ul class="stats-forecast">
        {#each forecast as day (day.dayNumber)}
          <li><span class="stats-muted">Day {day.dayNumber}</span> {day.due} due</li>
        {/each}
      </ul>
    </article>

    <article class="stats-panel">
      <h2>FSRS optimizer</h2>
      <p class="stats-muted">Preview adjusts preset parameters from your review history.</p>
      <div class="stats-actions">
        <button type="button" class="stats-btn" onclick={() => void previewOptimize()}
          >Preview</button
        >
        <button
          type="button"
          class="stats-btn"
          disabled={previewToken === null}
          onclick={() => void applyOptimize()}>Apply</button
        >
      </div>
      {#if optimizerStatus}
        <p class="stats-status" role="status">{optimizerStatus}</p>
      {/if}
    </article>
  {/if}
</section>

<style>
  .stats-screen {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    min-height: 0;
  }

  .stats-title {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .stats-grid {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  }

  .stats-card,
  .stats-panel {
    border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
    border-radius: 0.5rem;
    padding: 0.75rem 1rem;
  }

  .stats-card h2,
  .stats-panel h2 {
    margin: 0 0 0.35rem;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.75;
  }

  .stats-muted {
    opacity: 0.7;
    font-size: 0.9rem;
  }

  .stats-status {
    margin: 0;
    font-size: 0.9rem;
  }

  .stats-heatmap {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    max-height: 4rem;
    overflow: hidden;
  }

  .stats-heat {
    width: 8px;
    height: 8px;
    border-radius: 1px;
    background: color-mix(in srgb, currentColor 8%, transparent);
  }

  .stats-heat[data-level='1'] {
    background: color-mix(in srgb, currentColor 25%, transparent);
  }

  .stats-heat[data-level='2'] {
    background: color-mix(in srgb, currentColor 45%, transparent);
  }

  .stats-heat[data-level='3'] {
    background: color-mix(in srgb, currentColor 65%, transparent);
  }

  .stats-heat[data-level='4'] {
    background: color-mix(in srgb, currentColor 85%, transparent);
  }

  .stats-forecast {
    margin: 0;
    padding-left: 1.1rem;
    font-size: 0.9rem;
  }

  .stats-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .stats-btn {
    min-height: 2.75rem;
    min-width: 5.5rem;
    padding: 0.35rem 0.85rem;
    border-radius: 0.35rem;
    border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
    background: color-mix(in srgb, currentColor 6%, transparent);
    color: inherit;
    cursor: pointer;
  }

  .stats-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
