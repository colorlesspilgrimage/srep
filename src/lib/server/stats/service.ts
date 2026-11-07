import { fail, type Result } from '#lib/server/auth/deps.js';
import type { DbHandle } from '#lib/server/db/client.js';
import { DEFAULT_PRESET_ID } from '#lib/server/domain/builtin.js';
import type { PresetRow } from '#lib/server/domain/store/store-types.js';
import {
  buildHeatmap,
  cardDistribution,
  computeRetention,
  forecastDue,
  reviewsInWindow,
  studyStreak,
  summarizeToday,
} from '#lib/server/stats/metrics/pure.js';
import {
  listCardDueRows,
  listReviewStats,
  listReviewStatsSince,
} from '#lib/server/stats/queries.js';
import type {
  DistributionStats,
  ForecastDay,
  HeatmapCell,
  RetentionStats,
  StreakStats,
  TodayStats,
} from '#lib/server/stats/types.js';
import { studyWindow } from '#lib/server/study/core/day-clock.js';
import type { StudyDeps } from '#lib/server/study/deps.js';
import { getSettings } from '#lib/server/study/study-settings.js';

const DAY_MS = 86_400_000;

function clampDays(raw: string | null, fallback: number, max: number): number {
  const n = raw === null ? fallback : Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    return fallback;
  }
  return Math.min(max, n);
}

async function settingsOrFail(deps: StudyDeps) {
  const settings = await getSettings(deps);
  if (!settings.ok) {
    return settings;
  }
  return settings;
}

export async function getTodayStats(
  db: DbHandle,
  deps: StudyDeps,
): Promise<Result<{ today: TodayStats }>> {
  const settings = await settingsOrFail(deps);
  if (!settings.ok) {
    return settings;
  }
  const nowMs = deps.now();
  const window = studyWindow(nowMs, settings.settings);
  const rows = await listReviewStats(db);
  const today = summarizeToday(reviewsInWindow(rows, window.startMs, window.endMs));
  return { ok: true, today };
}

export async function getHeatmap(
  db: DbHandle,
  deps: StudyDeps,
  daysParam: string | null,
): Promise<Result<{ cells: HeatmapCell[] }>> {
  const settings = await settingsOrFail(deps);
  if (!settings.ok) {
    return settings;
  }
  const days = clampDays(daysParam, 365, 730);
  const nowMs = deps.now();
  const today = studyWindow(nowMs, settings.settings).dayNumber;
  const sinceMs = nowMs - days * DAY_MS;
  const rows = await listReviewStatsSince(db, sinceMs);
  const cells = buildHeatmap(rows, settings.settings, today - days + 1, today);
  return { ok: true, cells };
}

async function defaultDesiredRetention(deps: StudyDeps): Promise<number> {
  const presets = await deps.domain.listPresets();
  const preset = presets.find((p) => p.id === DEFAULT_PRESET_ID);
  return preset?.desiredRetention ?? 0.9;
}

export async function getRetention(
  db: DbHandle,
  deps: StudyDeps,
  presetId: string | null,
): Promise<Result<{ retention: RetentionStats }>> {
  const settings = await settingsOrFail(deps);
  if (!settings.ok) {
    return settings;
  }
  const presets = await deps.domain.listPresets();
  let desired = await defaultDesiredRetention(deps);
  if (presetId !== null) {
    const preset = presets.find((p) => p.id === presetId);
    if (preset === undefined) {
      return fail(404, 'not_found');
    }
    desired = preset.desiredRetention;
  }
  const rows = await listReviewStats(db);
  const retention = computeRetention(rows, desired, presetId);
  return { ok: true, retention };
}

export async function getForecast(
  db: DbHandle,
  deps: StudyDeps,
  daysParam: string | null,
): Promise<Result<{ days: ForecastDay[] }>> {
  const settings = await settingsOrFail(deps);
  if (!settings.ok) {
    return settings;
  }
  const horizon = clampDays(daysParam, 30, 90);
  const cards = await listCardDueRows(db);
  const days = forecastDue(cards, settings.settings, deps.now(), horizon);
  return { ok: true, days };
}

export async function getDistribution(
  db: DbHandle,
  deps: StudyDeps,
): Promise<Result<{ distribution: DistributionStats }>> {
  const settings = await settingsOrFail(deps);
  if (!settings.ok) {
    return settings;
  }
  const cards = await listCardDueRows(db);
  const distribution = cardDistribution(cards, deps.now());
  return { ok: true, distribution };
}

export async function getStreak(
  db: DbHandle,
  deps: StudyDeps,
): Promise<Result<{ streak: StreakStats }>> {
  const settings = await settingsOrFail(deps);
  if (!settings.ok) {
    return settings;
  }
  const rows = await listReviewStats(db);
  const streak = studyStreak(rows, settings.settings, deps.now());
  return { ok: true, streak };
}

export async function findPreset(deps: StudyDeps, id: string): Promise<PresetRow | null> {
  const presets = await deps.domain.listPresets();
  return presets.find((p) => p.id === id) ?? null;
}
