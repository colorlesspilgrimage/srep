// Contract: bulk suspend, unsuspend and bury (at most 500 ids, checked by the route schema).
// All or nothing: one unknown id gives 404 not_found and changes nothing.
// unsuspend: 409 card_orphaned for an orphaned cloze card. bury: the cards come back at the
// next rollover of the study day. 500 settings_corrupt when the stored settings are bad.
import { fail, type Failure, type Result } from '#lib/server/auth/deps.js';
import { planBury, planSuspend, planUnsuspend } from '#lib/server/study/core/card-state-plan.js';
import { studyWindow } from '#lib/server/study/core/day-clock.js';
import type { StudyDeps } from '#lib/server/study/deps.js';
import type { ChangeCardStatesResult } from '#lib/server/study/store/study-store-types.js';
import { getSettings } from '#lib/server/study/study-settings.js';

function toResult(result: ChangeCardStatesResult): Result<object> {
  if (result === 'card_not_found') {
    return fail(404, 'not_found');
  }
  return result.ok ? { ok: true } : (result satisfies Failure);
}

export async function suspendCards(deps: StudyDeps, cardIds: string[]): Promise<Result<object>> {
  return toResult(await deps.store.changeCardStates(cardIds, planSuspend));
}

export async function unsuspendCards(deps: StudyDeps, cardIds: string[]): Promise<Result<object>> {
  return toResult(await deps.store.changeCardStates(cardIds, planUnsuspend));
}

export async function buryCards(deps: StudyDeps, cardIds: string[]): Promise<Result<object>> {
  const settings = await getSettings(deps);
  if (!settings.ok) {
    return settings;
  }
  const { endMs } = studyWindow(deps.now(), settings.settings);
  return toResult(await deps.store.changeCardStates(cardIds, (cards) => planBury(cards, endMs)));
}
