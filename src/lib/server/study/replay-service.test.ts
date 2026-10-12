import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { BASIC_REVERSED_ID } from '#lib/server/domain/builtin.js';
import { updatePreset } from '#lib/server/domain/presets.js';
import { execSql } from '#lib/server/domain/store/suite-support.js';
import { PRESET_INPUT } from '#lib/server/domain/test-support/fixtures.js';
import { rebuildFromLog, verifyReplay } from '#lib/server/study/replay-service.js';
import { answer } from '#lib/server/study/study-answer.js';
import {
  addDeck,
  addPreset,
  addStudyNote,
  createStudyHarness,
  type StudyHarness,
} from '#lib/server/study/test-support/harness.js';

const DAY = 86_400_000;

let h: StudyHarness;
afterEach(async () => {
  await h.close();
});

// Answers each card a few times over several days.
async function studySome(cardIds: string[]): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    for (const cardId of cardIds) {
      const card = (await h.studyStore.readCard(cardId))?.card;
      const result = await answer(h.study, {
        cardId,
        rating: round === 1 ? 1 : 3,
        reps: card?.reps ?? 0,
        elapsedMs: 1000,
      });
      if (!result.ok) throw new Error(result.error);
    }
    h.clock.now += 3 * DAY;
  }
}

describe('verifyReplay and rebuildFromLog', () => {
  it('finds 0 mismatches, lists a tampered card, and rebuild repairs it', async () => {
    h = await createStudyHarness();
    const preset = await addPreset(h, { name: 'Replay' });
    const deck = await addDeck(h, 'Replay', { presetId: preset.id });
    const { cardIds } = await addStudyNote(h, deck.id, ['a', 'b'], BASIC_REVERSED_ID);
    await addStudyNote(h, deck.id);
    await studySome(cardIds);
    expect(await verifyReplay(h.study)).toEqual({
      ok: true,
      report: { checked: 3, skipped: 0, mismatches: [], chainMismatches: [] },
    });
    const [tampered] = cardIds as [string];
    await execSql(h, sql`update card set stability = 1.5 where id = ${tampered}`);
    expect(await verifyReplay(h.study)).toMatchObject({
      report: { mismatches: [{ cardId: tampered, fields: ['stability'] }] },
    });
    expect(await rebuildFromLog(h.study)).toEqual({ ok: true, checked: 3, changed: 1, skipped: 0 });
    expect(await verifyReplay(h.study)).toMatchObject({ report: { mismatches: [] } });
    expect(await rebuildFromLog(h.study)).toMatchObject({ changed: 0 });
  });

  it('reports a preset edit as a mismatch and rebuild applies the new preset', async () => {
    h = await createStudyHarness();
    const preset = await addPreset(h, { name: 'Edit' });
    const deck = await addDeck(h, 'Edit', { presetId: preset.id });
    const { cardIds } = await addStudyNote(h, deck.id);
    await studySome(cardIds);
    const edit = { ...PRESET_INPUT, name: 'Edit', learningSteps: [5, 20] };
    expect((await updatePreset(h.deps, preset.id, edit)).ok).toBe(true);
    const report = await verifyReplay(h.study);
    expect(report.ok && report.report.mismatches.length).toBe(1);
    expect(await rebuildFromLog(h.study)).toMatchObject({ changed: 1 });
    expect(await verifyReplay(h.study)).toMatchObject({ report: { mismatches: [] } });
  });

  it('skips a card whose preset ts-fsrs refuses', async () => {
    h = await createStudyHarness();
    const preset = await addPreset(h, { name: 'Bad', fsrsParams: Array(20).fill(0.5) });
    const deck = await addDeck(h, 'Bad', { presetId: preset.id });
    await addStudyNote(h, deck.id);
    expect(await verifyReplay(h.study)).toMatchObject({ report: { checked: 1, skipped: 1 } });
    expect(await rebuildFromLog(h.study)).toEqual({ ok: true, checked: 1, changed: 0, skipped: 1 });
  });

  it('uses the default preset for a card without a deck', async () => {
    h = await createStudyHarness();
    const deck = await addDeck(h, 'Gone');
    const { cardIds } = await addStudyNote(h, deck.id);
    await studySome(cardIds);
    await execSql(h, sql`update card set deck_id = null`);
    expect(await verifyReplay(h.study)).toMatchObject({
      report: { checked: 1, skipped: 0, mismatches: [] },
    });
  });
});
