import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createStudyHarness, type StudyHarness } from '#lib/server/study/test-support/harness.js';
import { runSimulation, type SimulationResult } from '#lib/server/study/test-support/simulation.js';
import { queryRows } from '#lib/server/study/test-support/simulation-checks.js';

const harnesses: StudyHarness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) {
    await h.close();
  }
});

async function simulate(days: number, seed: number) {
  const h = await createStudyHarness();
  harnesses.push(h);
  const progress: { day: number; reviews: number }[] = [];
  const setup = { study: h.study, domain: h.deps, handle: h.handle, clock: h.clock };
  const result = await runSimulation(setup, {
    days,
    seed,
    onProgress: (line) => progress.push(line),
  });
  const cards = await queryRows(h.handle, sql`select * from card order by id`);
  return { result, progress, cards };
}

function expectConsistent(result: SimulationResult): void {
  expect(result.details).toMatchObject({
    limitBreaks: 0,
    queueBreaks: 0,
    dayOverruns: 0,
    verifyMismatches: 0,
    chainMismatches: 0,
    rebuildChanged: 0,
    lastReviewBreaks: 0,
    logOrderBreaks: 0,
    undoBreaks: 0,
    suspendBreaks: 0,
  });
  expect(result.limitViolations).toBe(0);
  expect(result.replayMismatches).toBe(0);
  expect(result.undoMismatches).toBe(0);
}

// The milestone exit test: a 365-day run with a fake clock stays consistent.
describe('365-day study simulation', { timeout: 120_000 }, () => {
  it('keeps limits, replays to the cached state, and undo restores the exact rows', async () => {
    const first = await simulate(365, 42);
    expectConsistent(first.result);
    expect(first.result.reviews).toBeGreaterThan(200);
    expect(first.result.details.undoChecks).toBeGreaterThan(20);
    expect(first.result.details.suspendChecks).toBeGreaterThan(15);
    expect(first.progress.map((p) => p.day)).toEqual([
      30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360,
    ]);
    const second = await simulate(365, 42);
    expect(second.result).toEqual(first.result);
    expect(second.cards).toEqual(first.cards);
  });
});
