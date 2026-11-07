import { fail, type Result } from '#lib/server/auth/deps.js';
import type { DbHandle } from '#lib/server/db/client.js';
import { getDomainContext } from '#lib/server/domain/context.js';
import { updatePreset } from '#lib/server/domain/presets.js';
import { newId } from '#lib/server/domain/ids.js';
import {
  MIN_REVIEWS_FOR_OPTIMIZE,
  previewOptimizer,
  type OptimizerPreview,
} from '#lib/server/stats/optimizer.js';
import {
  clearExpiredOptimizerPreviews,
  stashOptimizerPreview,
  takeOptimizerPreview,
} from '#lib/server/stats/pending-optimizer.js';
import { countReviewsForPreset, listPresetReviews } from '#lib/server/stats/queries.js';
import { findPreset } from '#lib/server/stats/service.js';
import type { StudyDeps } from '#lib/server/study/deps.js';

export type OptimizerApplyBody = {
  presetId: string;
  previewToken: string;
};

export async function optimizerPreview(
  db: DbHandle,
  deps: StudyDeps,
  presetId: string,
): Promise<Result<OptimizerPreview>> {
  const preset = await findPreset(deps, presetId);
  if (preset === null) {
    return fail(404, 'not_found');
  }
  const nowMs = deps.now();
  clearExpiredOptimizerPreviews(nowMs);
  const reviewCount = await countReviewsForPreset(db, presetId);
  const rows = await listPresetReviews(db, presetId);
  const previewToken = newId(deps.random);
  const result = previewOptimizer(preset, reviewCount, rows, previewToken);
  if (!result.ok) {
    return result;
  }
  stashOptimizerPreview(
    previewToken,
    presetId,
    result.proposed.desiredRetention,
    result.proposed.fsrsParams,
    nowMs,
  );
  return result;
}

export async function optimizerApply(
  db: DbHandle,
  deps: StudyDeps,
  body: OptimizerApplyBody,
): Promise<Result<{ presetId: string }>> {
  const preset = await findPreset(deps, body.presetId);
  if (preset === null) {
    return fail(404, 'not_found');
  }
  const pending = takeOptimizerPreview(body.previewToken, deps.now());
  if (pending === null || pending.presetId !== body.presetId) {
    return fail(409, 'preview_expired');
  }
  const reviewCount = await countReviewsForPreset(db, body.presetId);
  if (reviewCount < MIN_REVIEWS_FOR_OPTIMIZE) {
    return fail(422, 'insufficient_reviews');
  }
  const updated = await updatePreset(getDomainContext(), body.presetId, {
    name: preset.name,
    newPerDay: preset.newPerDay,
    reviewsPerDay: preset.reviewsPerDay,
    desiredRetention: pending.proposedDesiredRetention,
    learningSteps: preset.learningSteps,
    relearningSteps: preset.relearningSteps,
    maxInterval: preset.maxInterval,
    fsrsParams: pending.proposedFsrsParams,
    burySiblings: preset.burySiblings,
    newOrder: preset.newOrder,
  });
  if (!updated.ok) {
    return updated;
  }
  return { ok: true, presetId: body.presetId };
}
