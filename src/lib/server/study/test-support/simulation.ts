// The study simulation: N study days with a fake clock and seeded random ratings.
// The milestone test and scripts/study-simulate.ts both run it. No vitest import here.
// Counters in the result:
// - limitViolations: a deck passed its daily limit (plain SQL count), the queue offered a
//   suspended or buried card, or a day did not end within MAX_STEPS_PER_DAY.
// - replayMismatches: verify mismatches, chain mismatches, cards that rebuild changed,
//   last_review not equal to the latest log time, log times that do not increase.
// - undoMismatches: answer + undo, or suspend + unsuspend, did not restore the exact rows.
import type { Result } from '#lib/server/auth/deps.js';
import type { DbHandle } from '#lib/server/db/client.js';
import { BASIC_ID, BASIC_REVERSED_ID, CLOZE_ID } from '#lib/server/domain/builtin.js';
import { createDeck } from '#lib/server/domain/decks.js';
import type { DomainDeps } from '#lib/server/domain/deps.js';
import { createNote } from '#lib/server/domain/notes.js';
import { createPreset } from '#lib/server/domain/presets.js';
import { seedDomain } from '#lib/server/domain/seed.js';
import type { DeckRow } from '#lib/server/domain/store/store-types.js';
import { PRESET_INPUT } from '#lib/server/domain/test-support/fixtures.js';
import { suspendCards, unsuspendCards } from '#lib/server/study/card-state.js';
import { studyWindow } from '#lib/server/study/core/day-clock.js';
import { DEFAULT_STUDY_SETTINGS, type StudyWindow } from '#lib/server/study/core/types.js';
import type { StudyDeps } from '#lib/server/study/deps.js';
import { rebuildFromLog, verifyReplay } from '#lib/server/study/replay-service.js';
import { answer, undo } from '#lib/server/study/study-answer.js';
import { getNext, type NextReply } from '#lib/server/study/study-next.js';
import { updateSettings } from '#lib/server/study/study-settings.js';
import {
  cardStateOf,
  countLastReviewBreaks,
  countLimitBreaks,
  countLogOrderBreaks,
  fullSnapshot,
  seededUnitRandom,
} from '#lib/server/study/test-support/simulation-checks.js';

export type SimulationSetup = {
  study: StudyDeps;
  domain: DomainDeps;
  handle: DbHandle;
  /** The one clock that both deps read. */
  clock: { now: number };
};

export type SimulationOptions = {
  days: number;
  seed: number;
  /** Called after every 30 days. */
  onProgress?: (line: { day: number; reviews: number }) => void;
};

export type SimulationDetails = {
  limitBreaks: number;
  queueBreaks: number;
  dayOverruns: number;
  verifyMismatches: number;
  chainMismatches: number;
  rebuildChanged: number;
  lastReviewBreaks: number;
  logOrderBreaks: number;
  undoBreaks: number;
  suspendBreaks: number;
  undoChecks: number;
  suspendChecks: number;
};

export type SimulationResult = {
  days: number;
  reviews: number;
  limitViolations: number;
  replayMismatches: number;
  undoMismatches: number;
  details: SimulationDetails;
};

export const SIMULATION_START = Date.parse('2026-01-01T09:00:00Z');
const SETTINGS = DEFAULT_STUDY_SETTINGS;
const MAX_STEPS_PER_DAY = 2000;
const HOUR_MS = 3_600_000;
// 12 notes give 5 Basic+Reversed, 5 Cloze (2 cards each) and 2 Basic: 22 cards.
const NOTE_KIND_CYCLE = [BASIC_REVERSED_ID, CLOZE_ID, BASIC_ID, BASIC_REVERSED_ID, CLOZE_ID];

type Sim = {
  setup: SimulationSetup;
  rng: () => number;
  root: DeckRow;
  child: DeckRow;
  notes: number;
  reviews: number;
  details: SimulationDetails;
};

function must<T extends object>(result: Result<T>): { ok: true } & T {
  if (!result.ok) {
    throw new Error(`simulation step failed: ${result.error}`);
  }
  return result;
}

// Weighted: Again 10%, Hard 10%, Good 65%, Easy 15%.
function pickRating(rng: () => number): 1 | 2 | 3 | 4 {
  const x = rng();
  return x < 0.1 ? 1 : x < 0.2 ? 2 : x < 0.85 ? 3 : 4;
}

async function addNote(sim: Sim): Promise<void> {
  const i = sim.notes;
  const noteTypeId = NOTE_KIND_CYCLE[i % NOTE_KIND_CYCLE.length] as string;
  const fields =
    noteTypeId === CLOZE_ID
      ? [`{{c1::alpha ${i}}} and {{c2::beta ${i}}}`, '']
      : [`front ${i}`, `back ${i}`];
  const deckId = i % 2 === 0 ? sim.root.id : sim.child.id;
  must(await createNote(sim.setup.domain, { noteTypeId, deckId, fields, tags: ['sim'] }));
  sim.notes += 1;
}

async function createSimDecks(setup: SimulationSetup, seed: number) {
  const { domain } = setup;
  await seedDomain(domain);
  const rootPreset = must(
    await createPreset(domain, {
      ...PRESET_INPUT,
      name: `Simulation root ${seed}`,
      newPerDay: 5,
      reviewsPerDay: 20,
    }),
  ).preset;
  const childPreset = must(
    await createPreset(domain, {
      ...PRESET_INPUT,
      name: `Simulation child ${seed}`,
      newPerDay: 3,
      reviewsPerDay: 10,
      burySiblings: true,
    }),
  ).preset;
  const root = must(
    await createDeck(domain, { name: `Simulation ${seed}`, presetId: rootPreset.id }),
  ).deck;
  const child = must(
    await createDeck(domain, { name: 'Child', parentId: root.id, presetId: childPreset.id }),
  ).deck;
  return { root, child };
}

async function nextReply(sim: Sim): Promise<NextReply> {
  return must(await getNext(sim.setup.study, { deckId: sim.root.id })).reply;
}

async function answerReply(sim: Sim, reply: NextReply & { status: 'card' }, elapsedMs: number) {
  const input = { cardId: reply.card.id, rating: pickRating(sim.rng), reps: reply.card.reps };
  must(await answer(sim.setup.study, { ...input, elapsedMs }));
}

// Answer one card, then undo: every card row and log row must be as before.
async function undoCheck(sim: Sim): Promise<void> {
  const reply = await nextReply(sim);
  if (reply.status !== 'card') {
    return;
  }
  const before = await fullSnapshot(sim.setup.handle);
  await answerReply(sim, reply, 1000);
  must(await undo(sim.setup.study));
  sim.details.undoChecks += 1;
  if ((await fullSnapshot(sim.setup.handle)) !== before) {
    sim.details.undoBreaks += 1;
  }
}

// Suspend the next card: the queue must not offer it. Unsuspend restores the exact rows.
async function suspendCheck(sim: Sim): Promise<void> {
  const reply = await nextReply(sim);
  if (reply.status !== 'card') {
    return;
  }
  const { handle, study } = sim.setup;
  const before = await fullSnapshot(handle);
  must(await suspendCards(study, [reply.card.id]));
  const again = await nextReply(sim);
  if (again.status === 'card' && again.card.id === reply.card.id) {
    sim.details.queueBreaks += 1;
  }
  if ((await cardStateOf(handle, reply.card.id)) !== 'suspended') {
    sim.details.suspendBreaks += 1;
  }
  must(await unsuspendCards(study, [reply.card.id]));
  sim.details.suspendChecks += 1;
  if ((await fullSnapshot(handle)) !== before) {
    sim.details.suspendBreaks += 1;
  }
}

// next and answer until done. A wait inside the study day moves the clock to its time.
async function studyUntilDone(sim: Sim, window: StudyWindow): Promise<void> {
  const { clock } = sim.setup;
  for (let step = 0; step < MAX_STEPS_PER_DAY; step += 1) {
    const reply = await nextReply(sim);
    if (reply.status === 'done') {
      return;
    }
    if (reply.status === 'wait') {
      if (reply.until >= window.endMs) {
        return;
      }
      clock.now = reply.until;
      continue;
    }
    if (reply.card.state === 'suspended' || reply.card.state === 'buried') {
      sim.details.queueBreaks += 1;
    }
    const elapsedMs = 2000 + Math.floor(sim.rng() * 20_000);
    await answerReply(sim, reply, elapsedMs);
    sim.reviews += 1;
    clock.now += elapsedMs;
    if (clock.now >= window.endMs) {
      return;
    }
  }
  sim.details.dayOverruns += 1;
}

async function simulateDay(sim: Sim, day: number): Promise<void> {
  const { clock, handle, domain } = sim.setup;
  const window = studyWindow(clock.now, SETTINGS);
  if (day % 13 === 5) {
    await undoCheck(sim);
  }
  if (day % 17 === 3) {
    await suspendCheck(sim);
  }
  await studyUntilDone(sim, window);
  const decks = await domain.store.listDecks();
  const presets = await domain.store.listPresets();
  sim.details.limitBreaks += await countLimitBreaks(handle, window, decks, presets);
  if (day % 7 === 6) {
    await addNote(sim);
  }
  // Jump to a random time in the next study day (never back in time).
  const next = studyWindow(window.endMs, SETTINGS);
  const span = next.endMs - next.startMs - 4 * HOUR_MS;
  clock.now = Math.max(clock.now, next.startMs + Math.floor(sim.rng() * span));
}

async function finalChecks(sim: Sim): Promise<void> {
  const { study, handle } = sim.setup;
  const report = must(await verifyReplay(study)).report;
  sim.details.verifyMismatches = report.mismatches.length + report.skipped;
  sim.details.chainMismatches = report.chainMismatches.length;
  sim.details.rebuildChanged = must(await rebuildFromLog(study)).changed;
  sim.details.lastReviewBreaks = await countLastReviewBreaks(handle);
  sim.details.logOrderBreaks = await countLogOrderBreaks(handle);
}

function emptyDetails(): SimulationDetails {
  return {
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
    undoChecks: 0,
    suspendChecks: 0,
  };
}

export async function runSimulation(
  setup: SimulationSetup,
  options: SimulationOptions,
): Promise<SimulationResult> {
  setup.clock.now = SIMULATION_START;
  must(await updateSettings(setup.study, SETTINGS));
  const decks = await createSimDecks(setup, options.seed);
  const sim: Sim = {
    setup,
    rng: seededUnitRandom(options.seed),
    ...decks,
    notes: 0,
    reviews: 0,
    details: emptyDetails(),
  };
  for (let i = 0; i < 12; i += 1) {
    await addNote(sim);
  }
  for (let day = 0; day < options.days; day += 1) {
    await simulateDay(sim, day);
    if ((day + 1) % 30 === 0) {
      options.onProgress?.({ day: day + 1, reviews: sim.reviews });
    }
  }
  await finalChecks(sim);
  const d = sim.details;
  return {
    days: options.days,
    reviews: sim.reviews,
    limitViolations: d.limitBreaks + d.queueBreaks + d.dayOverruns,
    replayMismatches:
      d.verifyMismatches +
      d.chainMismatches +
      d.rebuildChanged +
      d.lastReviewBreaks +
      d.logOrderBreaks,
    undoMismatches: d.undoBreaks + d.suspendBreaks,
    details: d,
  };
}
