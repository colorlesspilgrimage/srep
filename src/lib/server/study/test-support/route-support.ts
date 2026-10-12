import type { StudyDeps } from '#lib/server/study/deps.js';
import { createStudyHarness, type StudyHarness } from '#lib/server/study/test-support/harness.js';
import { domainRouteState } from '#lib/server/domain/test-support/route-support.js';

// The route tests mock getStudyContext and read the deps from here.
export const studyRouteState: { deps: StudyDeps | undefined } = { deps: undefined };

/** Sets both the study and the domain route context to one harness. */
export async function useStudyRouteContext(): Promise<StudyHarness> {
  const h = await createStudyHarness();
  studyRouteState.deps = h.study;
  domainRouteState.deps = h.deps;
  return h;
}
