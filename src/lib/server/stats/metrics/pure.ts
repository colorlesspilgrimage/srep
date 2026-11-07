import { studyWindow } from '#lib/server/study/core/day-clock.js';
import type { StudySettings } from '#lib/server/study/core/types.js';
import type {
  CardDueRow,
  ForecastDay,
  HeatmapCell,
  RetentionStats,
  ReviewStatRow,
  StreakStats,
  TodayStats,
} from '#lib/server/stats/types.js';

const DAY_MS = 86_400_000;

export function reviewsInWindow(
  rows: readonly ReviewStatRow[],
  startMs: number,
  endMs: number,
): readonly ReviewStatRow[] {
  return rows.filter((row) => row.reviewedAt >= startMs && row.reviewedAt < endMs);
}

export function summarizeToday(rows: readonly ReviewStatRow[]): TodayStats {
  let again = 0;
  let hard = 0;
  let good = 0;
  let easy = 0;
  let elapsedMs = 0;
  for (const row of rows) {
    elapsedMs += row.elapsedMs;
    if (row.rating === 1) again += 1;
    else if (row.rating === 2) hard += 1;
    else if (row.rating === 3) good += 1;
    else if (row.rating === 4) easy += 1;
  }
  return { reviews: rows.length, elapsedMs, again, hard, good, easy };
}

export function buildHeatmap(
  rows: readonly ReviewStatRow[],
  settings: StudySettings,
  minDay: number,
  maxDay: number,
): HeatmapCell[] {
  const counts = new Map<number, number>();
  for (const row of rows) {
    const day = studyWindow(row.reviewedAt, settings).dayNumber;
    if (day < minDay || day > maxDay) {
      continue;
    }
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const cells: HeatmapCell[] = [];
  for (let day = minDay; day <= maxDay; day += 1) {
    cells.push({ dayNumber: day, count: counts.get(day) ?? 0 });
  }
  return cells;
}

export function computeRetention(
  rows: readonly ReviewStatRow[],
  desiredRetention: number,
  presetFilter: string | null,
): RetentionStats {
  let matureReviews = 0;
  let passed = 0;
  for (const row of rows) {
    if (row.stateBefore !== 'review') {
      continue;
    }
    if (presetFilter !== null && row.presetId !== presetFilter) {
      continue;
    }
    matureReviews += 1;
    if (row.rating >= 3) {
      passed += 1;
    }
  }
  const trueRetention = matureReviews > 0 ? passed / matureReviews : null;
  return { matureReviews, passed, trueRetention, desiredRetention };
}

const BUCKETS = [
  { maxDays: 1, label: '<1d' },
  { maxDays: 7, label: '1–7d' },
  { maxDays: 30, label: '8–30d' },
  { maxDays: 90, label: '31–90d' },
  { maxDays: Infinity, label: '90d+' },
] as const;

function intervalDays(card: CardDueRow, nowMs: number): number {
  if (card.lastReview !== null && card.schedState === 'review') {
    return Math.max(0, (card.due - card.lastReview) / DAY_MS);
  }
  if (card.stability > 0) {
    return card.stability;
  }
  if (card.due > nowMs) {
    return (card.due - nowMs) / DAY_MS;
  }
  return 0;
}

export function cardDistribution(
  cards: readonly CardDueRow[],
  nowMs: number,
): { byState: Record<string, number>; intervalBuckets: { label: string; count: number }[] } {
  const byState: Record<string, number> = {};
  const bucketCounts = BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  for (const card of cards) {
    if (card.state === 'suspended' || card.state === 'buried') {
      continue;
    }
    byState[card.schedState] = (byState[card.schedState] ?? 0) + 1;
    const days = intervalDays(card, nowMs);
    for (let i = 0; i < BUCKETS.length; i += 1) {
      const bucket = BUCKETS[i];
      if (bucket === undefined) {
        break;
      }
      if (days <= bucket.maxDays) {
        bucketCounts[i]!.count += 1;
        break;
      }
    }
  }
  return { byState, intervalBuckets: bucketCounts };
}

export function forecastDue(
  cards: readonly CardDueRow[],
  settings: StudySettings,
  nowMs: number,
  horizonDays: number,
): ForecastDay[] {
  const today = studyWindow(nowMs, settings).dayNumber;
  const endDay = today + horizonDays;
  const counts = new Map<number, number>();
  for (let day = today; day <= endDay; day += 1) {
    counts.set(day, 0);
  }
  for (const card of cards) {
    if (card.state === 'suspended' || card.state === 'buried') {
      continue;
    }
    if (card.due > nowMs + horizonDays * DAY_MS + DAY_MS) {
      continue;
    }
    const day = studyWindow(card.due, settings).dayNumber;
    if (day < today || day > endDay) {
      continue;
    }
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts.entries()].map(([dayNumber, due]) => ({ dayNumber, due }));
}

export function studyStreak(
  rows: readonly ReviewStatRow[],
  settings: StudySettings,
  nowMs: number,
): StreakStats {
  const days = new Set<number>();
  for (const row of rows) {
    days.add(studyWindow(row.reviewedAt, settings).dayNumber);
  }
  const today = studyWindow(nowMs, settings).dayNumber;
  let current = 0;
  for (let day = today; day >= today - 10_000; day -= 1) {
    if (!days.has(day)) {
      break;
    }
    current += 1;
  }
  const sorted = [...days].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const day of sorted) {
    if (prev !== null && day === prev + 1) {
      run += 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    prev = day;
  }
  return { current, longest };
}
