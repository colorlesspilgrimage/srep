// Contract: reads and writes the study-day settings (app_settings key 'study').
// An absent value gives the defaults (rollover 04:00, UTC). A stored value that does not
// parse is a server error (500 settings_corrupt). It is logged and never silently replaced.
import { fail, type Result } from '#lib/server/auth/deps.js';
import { DEFAULT_STUDY_SETTINGS, type StudySettings } from '#lib/server/study/core/types.js';
import { studySettingsSchema } from '#lib/server/study/core/validation.js';
import type { StudyDeps } from '#lib/server/study/deps.js';

export async function getSettings(deps: StudyDeps): Promise<Result<{ settings: StudySettings }>> {
  const stored = await deps.store.getStudySettings();
  if (stored === undefined) {
    return { ok: true, settings: DEFAULT_STUDY_SETTINGS };
  }
  const parsed = studySettingsSchema.safeParse(stored);
  if (!parsed.success) {
    deps.logger.error({ key: 'study' }, 'stored study settings are not valid');
    return fail(500, 'settings_corrupt');
  }
  return { ok: true, settings: parsed.data };
}

export async function updateSettings(
  deps: StudyDeps,
  input: StudySettings,
): Promise<Result<{ settings: StudySettings }>> {
  await deps.store.putStudySettings(input);
  return { ok: true, settings: input };
}
