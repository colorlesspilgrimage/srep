import { describe, expect, it } from 'vitest';
import { BUILTIN_PRESET } from '#lib/server/domain/builtin.js';
import {
  answerCard,
  buildFsrs,
  newCardFields,
  previewAnswers,
  scheduleFsrsCard,
  toFsrsCard,
  type SchedulerPreset,
} from '#lib/server/study/core/fsrs-adapter.js';
import type { Rating, SchedFields } from '#lib/server/study/core/types.js';

// Golden values from ts-fsrs 5.4.2 with fuzz off. A change here is a schedule drift.
// Do not edit the numbers without a decision.
const T0 = Date.parse('2026-01-01T09:00:00Z');
const MIN = 60_000;
const DAY = 86_400_000;
const DEFAULT: SchedulerPreset = BUILTIN_PRESET;

type Step = { fields: SchedFields; at: number; intervalMinutes: number };

// Each answer happens at the due of the previous answer. The first one at T0.
function run(preset: SchedulerPreset, ratings: Rating[]): Step[] {
  let fields = newCardFields();
  let at = T0;
  const steps: Step[] = [];
  for (const rating of ratings) {
    const result = answerCard(preset, fields, rating, at);
    if (result === null) {
      throw new Error('bad preset');
    }
    steps.push({ fields: result.fields, at, intervalMinutes: result.intervalMinutes });
    fields = result.fields;
    at = result.fields.due;
  }
  return steps;
}

type Golden = {
  state: SchedFields['schedState'];
  due: string | number;
  s?: number;
  d?: number;
  reps?: number;
  lapses?: number;
  step?: number;
};

function expectGolden(steps: Step[], golden: Golden[]): void {
  expect(steps).toHaveLength(golden.length);
  golden.forEach((g, i) => {
    const f = (steps[i] as Step).fields;
    expect(f.schedState, `row ${i}`).toBe(g.state);
    expect(f.due, `row ${i}`).toBe(typeof g.due === 'string' ? Date.parse(g.due) : g.due);
    if (g.s !== undefined) expect(f.stability, `row ${i}`).toBeCloseTo(g.s, 7);
    if (g.d !== undefined) expect(f.difficulty, `row ${i}`).toBeCloseTo(g.d, 7);
    if (g.reps !== undefined) expect(f.reps, `row ${i}`).toBe(g.reps);
    if (g.lapses !== undefined) expect(f.lapses, `row ${i}`).toBe(g.lapses);
    if (g.step !== undefined) expect(f.learningStep, `row ${i}`).toBe(g.step);
    expect(f.lastReview, `row ${i}`).toBe((steps[i] as Step).at);
  });
}

describe('golden FSRS schedules', () => {
  it('A: default preset with a lapse', () => {
    expectGolden(run(DEFAULT, [3, 3, 3, 1, 3, 3, 4]), [
      { state: 'learning', due: T0 + 10 * MIN, s: 2.3065, d: 2.11810397, reps: 1, step: 1 },
      {
        state: 'review',
        due: '2026-01-03T09:10:00Z',
        s: 2.3065,
        d: 2.11121424,
        reps: 2,
        step: 0,
      },
      { state: 'review', due: '2026-01-14T09:10:00Z', s: 10.97104786, d: 2.1043314, reps: 3 },
      {
        state: 'relearning',
        due: '2026-01-14T09:20:00Z',
        s: 1.5390125,
        d: 7.38997579,
        reps: 4,
        lapses: 1,
      },
      { state: 'review', due: '2026-01-16T09:20:00Z', s: 1.57184156, d: 7.37781418, reps: 5 },
      { state: 'review', due: '2026-01-21T09:20:00Z', s: 4.93476853, d: 7.36566474, reps: 6 },
      { state: 'review', due: '2026-02-09T09:20:00Z', s: 18.93634302, d: 6.47062102, reps: 7 },
    ]);
  });

  it('B: learning steps with Again and Hard', () => {
    const steps = run(DEFAULT, [1, 2, 3, 3]);
    const t1 = T0 + MIN;
    const t2 = t1 + 6 * MIN;
    expectGolden(steps, [
      { state: 'learning', due: t1, s: 0.212, d: 6.4133, reps: 1 },
      { state: 'learning', due: t2, d: 7.60420977, reps: 2 },
      { state: 'learning', due: t2 + 10 * MIN, s: 0.24668919, reps: 3, step: 1 },
      { state: 'review', due: '2026-01-02T09:17:00Z', s: 0.28420636, reps: 4 },
    ]);
  });

  it('D: empty steps leave the schedule to FSRS', () => {
    const preset = { ...DEFAULT, learningSteps: [], relearningSteps: [] };
    expectGolden(run(preset, [3, 3, 1, 3]), [
      { state: 'review', due: '2026-01-03T09:00:00Z', s: 2.3065 },
      { state: 'review', due: '2026-01-14T09:00:00Z', s: 10.96433194 },
      { state: 'review', due: '2026-01-16T09:00:00Z', s: 1.5383372, d: 7.39223814, lapses: 1 },
      { state: 'review', due: '2026-01-21T09:00:00Z', s: 4.87625996 },
    ]);
  });

  it('E: retention 0.8 gives longer intervals', () => {
    const preset = { ...DEFAULT, desiredRetention: 0.8 };
    expectGolden(run(preset, [3, 3, 3, 3]), [
      { state: 'learning', due: T0 + 10 * MIN },
      { state: 'review', due: '2026-01-09T09:10:00Z' },
      { state: 'review', due: '2026-03-26T09:10:00Z' },
      { state: 'review', due: '2027-09-02T09:10:00Z', s: 158.3022468 },
    ]);
  });

  it('clamps every interval to maxInterval days', () => {
    const preset = { ...DEFAULT, maxInterval: 30 };
    for (const step of run(preset, [4, 4, 4, 4])) {
      expect(step.fields.due - step.at).toBeLessThanOrEqual(30 * DAY);
    }
    const one = run({ ...DEFAULT, maxInterval: 1 }, [4, 4, 4]);
    expect(one.every((s) => s.fields.due - s.at <= DAY)).toBe(true);
  });
});

describe('fsrs adapter', () => {
  it('does not depend on elapsed_days or scheduled_days', () => {
    const steps = run(DEFAULT, [3, 3, 3]);
    const before = (steps[1] as Step).fields;
    const at = before.due + 3 * DAY;
    const scheduler = buildFsrs(DEFAULT);
    if (scheduler === null) {
      throw new Error('bad preset');
    }
    const plain = scheduleFsrsCard(scheduler, 36_500, toFsrsCard(before), 3, at);
    const odd = scheduleFsrsCard(scheduler, 36_500, toFsrsCard(before, 99, 7), 3, at);
    expect(odd).toEqual(plain);
    expect(answerCard(DEFAULT, before, 3, at)).toEqual(plain);
  });

  it('does not depend on the due of a new card', () => {
    const a = answerCard(DEFAULT, newCardFields(), 3, T0);
    const b = answerCard(DEFAULT, { ...newCardFields(), due: T0 - 5 * DAY }, 3, T0);
    expect(b).toEqual(a);
  });

  it('accepts 19 and 21 parameters and refuses a bad array without a throw', () => {
    const w21 = [
      0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
      0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
    ];
    expect(buildFsrs({ ...DEFAULT, fsrsParams: w21 })).not.toBeNull();
    expect(answerCard({ ...DEFAULT, fsrsParams: w21 }, newCardFields(), 3, T0)).toEqual(
      answerCard(DEFAULT, newCardFields(), 3, T0),
    );
    expect(buildFsrs({ ...DEFAULT, fsrsParams: w21.slice(0, 19) })).not.toBeNull();
    // ts-fsrs accepts 17, 19 or 21 numbers only. The preset schema allows 20, so the
    // adapter must refuse it here (the service answers 422 bad_preset).
    expect(buildFsrs({ ...DEFAULT, fsrsParams: w21.slice(0, 20) })).toBeNull();
    expect(buildFsrs({ ...DEFAULT, fsrsParams: [1, 2, 3, 4, 5] })).toBeNull();
    expect(buildFsrs({ ...DEFAULT, fsrsParams: [...w21.slice(0, 20), Number.NaN] })).toBeNull();
    expect(answerCard({ ...DEFAULT, fsrsParams: [1] }, newCardFields(), 3, T0)).toBeNull();
    expect(previewAnswers({ ...DEFAULT, fsrsParams: [1] }, newCardFields(), T0)).toBeNull();
  });

  it('gives previews that equal the real answers', () => {
    const fields = (run(DEFAULT, [3, 3]).at(-1) as Step).fields;
    const at = fields.due + DAY;
    const previews = previewAnswers(DEFAULT, fields, at);
    for (const rating of [1, 2, 3, 4] as const) {
      const real = answerCard(DEFAULT, fields, rating, at);
      expect(previews?.[rating]).toEqual({
        due: real?.fields.due,
        intervalMinutes: real?.intervalMinutes,
      });
    }
  });

  it('rounds the interval to whole minutes', () => {
    const steps = run(DEFAULT, [3, 3]);
    expect(steps[0]?.intervalMinutes).toBe(10);
    expect(steps[1]?.intervalMinutes).toBe(2 * 24 * 60);
  });

  it('rounds a fractional step to whole minutes, and supports ten steps and a 30-day step', () => {
    const half = run({ ...DEFAULT, learningSteps: [0.5] }, [1]);
    expect(half[0]?.fields).toMatchObject({ schedState: 'learning', due: T0 + MIN });
    const oneAndHalf = run({ ...DEFAULT, learningSteps: [1.5, 10] }, [1]);
    expect(oneAndHalf[0]?.fields.due).toBe(T0 + 2 * MIN);
    const ten = run({ ...DEFAULT, learningSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }, [3, 3, 3]);
    expect(ten.map((s) => s.fields.learningStep)).toEqual([1, 2, 3]);
    const month = run({ ...DEFAULT, learningSteps: [43_200] }, [1]);
    expect(month[0]?.fields.due).toBe(T0 + 43_200 * MIN);
  });
});
