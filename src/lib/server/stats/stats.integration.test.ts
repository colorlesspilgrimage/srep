import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRESET_ID } from '#lib/server/domain/builtin.js';
import {
  addDeck,
  addStudyNote,
  createStudyHarness,
  type StudyHarness,
} from '#lib/server/study/test-support/harness.js';
import { answer } from '#lib/server/study/study-answer.js';
import { getStreak, getTodayStats } from '#lib/server/stats/service.js';

let h: StudyHarness;

afterEach(async () => {
  await h?.close();
});

describe('stats integration', () => {
  it('counts reviews after study answers', async () => {
    h = await createStudyHarness();
    const deck = await addDeck(h, 'Stats');
    const { cardIds } = await addStudyNote(h, deck.id);
    const cardId = cardIds[0] as string;
    const first = await answer(h.study, { cardId, rating: 3, reps: 0, elapsedMs: 1200 });
    expect(first.ok).toBe(true);
    const again = await answer(h.study, { cardId, rating: 3, reps: 1, elapsedMs: 800 });
    expect(again.ok).toBe(true);
    const today = await getTodayStats(h.handle, h.study);
    expect(today.ok).toBe(true);
    if (today.ok) {
      expect(today.today.reviews).toBeGreaterThanOrEqual(2);
      expect(today.today.elapsedMs).toBeGreaterThanOrEqual(2000);
    }
    const streak = await getStreak(h.handle, h.study);
    expect(streak.ok).toBe(true);
    if (streak.ok) {
      expect(streak.streak.current).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('optimizer', () => {
  it('rejects preview below minimum reviews', async () => {
    h = await createStudyHarness();
    const { optimizerPreview } = await import('#lib/server/stats/optimizer-service.js');
    const result = await optimizerPreview(h.handle, h.study, DEFAULT_PRESET_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('insufficient_reviews');
    }
  });
});
