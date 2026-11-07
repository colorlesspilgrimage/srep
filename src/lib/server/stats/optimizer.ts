import { checkParameters, clipParameters, default_w, generatorParameters } from 'ts-fsrs';
import { fail, type Result } from '#lib/server/auth/deps.js';
import type { PresetRow } from '#lib/server/domain/store/store-types.js';
import { computeRetention } from '#lib/server/stats/metrics/pure.js';
import type { ReviewStatRow } from '#lib/server/stats/types.js';

export const MIN_REVIEWS_FOR_OPTIMIZE = 50;

export type OptimizerPreview = {
  reviewCount: number;
  current: { desiredRetention: number; fsrsParams: number[] | null };
  proposed: { desiredRetention: number; fsrsParams: number[] };
  retention: { trueRetention: number | null; matureReviews: number };
  previewToken: string;
};

function clampRetention(value: number): number {
  return Math.min(0.99, Math.max(0.7, value));
}

export function buildProposedParams(
  preset: PresetRow,
  rows: readonly ReviewStatRow[],
): { desiredRetention: number; fsrsParams: number[] } {
  const stats = computeRetention(rows, preset.desiredRetention, preset.id);
  const empirical = stats.trueRetention ?? preset.desiredRetention;
  const blend = clampRetention(empirical * 0.85 + preset.desiredRetention * 0.15);
  const baseW = preset.fsrsParams ?? [...default_w];
  checkParameters(baseW);
  const params = generatorParameters({
    request_retention: blend,
    maximum_interval: preset.maxInterval,
    w: baseW,
  });
  const fsrsParams = clipParameters([...params.w], preset.relearningSteps.length, true);
  return { desiredRetention: blend, fsrsParams };
}

export function previewOptimizer(
  preset: PresetRow,
  reviewCount: number,
  rows: readonly ReviewStatRow[],
  previewToken: string,
): Result<OptimizerPreview> {
  if (reviewCount < MIN_REVIEWS_FOR_OPTIMIZE) {
    return fail(422, 'insufficient_reviews');
  }
  const proposed = buildProposedParams(preset, rows);
  const retention = computeRetention(rows, preset.desiredRetention, preset.id);
  return {
    ok: true,
    reviewCount,
    current: { desiredRetention: preset.desiredRetention, fsrsParams: preset.fsrsParams },
    proposed,
    retention: { trueRetention: retention.trueRetention, matureReviews: retention.matureReviews },
    previewToken,
  };
}
