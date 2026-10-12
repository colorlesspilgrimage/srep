// Test harness for the study engine. It builds on the domain harness: a real store, a fake
// clock ({ now }) that both the domain and the study services read, and seeded random ids.
import { sql } from 'drizzle-orm';
import { seededRandom } from '#lib/server/auth/test-support/harness.js';
import { BASIC_ID } from '#lib/server/domain/builtin.js';
import { createDeck } from '#lib/server/domain/decks.js';
import { createNote } from '#lib/server/domain/notes.js';
import { createPreset } from '#lib/server/domain/presets.js';
import type { DeckRow, PresetRow } from '#lib/server/domain/store/store-types.js';
import { PRESET_INPUT } from '#lib/server/domain/test-support/fixtures.js';
import {
  createDomainHarness,
  createPgDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';
import type { StudyDeps } from '#lib/server/study/deps.js';
import { getStudyStore } from '#lib/server/study/store/store.js';
import type { StudyStore } from '#lib/server/study/store/study-store-types.js';

export type StudyHarness = DomainHarness & {
  study: StudyDeps;
  studyStore: StudyStore;
  /** Every logger.error call. */
  errors: { obj: object; msg: string | undefined }[];
};

/** 2026-01-01T09:00:00Z. Study tests start here. */
export const STUDY_T0 = Date.parse('2026-01-01T09:00:00Z');

function withStudy(h: DomainHarness): StudyHarness {
  const studyStore = getStudyStore(h.handle);
  const errors: StudyHarness['errors'] = [];
  h.clock.now = STUDY_T0;
  const study: StudyDeps = {
    store: studyStore,
    domain: h.store,
    now: () => h.clock.now,
    random: seededRandom(),
    logger: { error: (obj, msg) => errors.push({ obj, msg }) },
  };
  return { ...h, study, studyStore, errors };
}

export async function createStudyHarness(): Promise<StudyHarness> {
  return withStudy(await createDomainHarness());
}

// Every call starts with empty domain tables and no stored study settings.
export async function createPgStudyHarness(url: string): Promise<StudyHarness> {
  const h = await createPgDomainHarness(url);
  if (h.handle.dialect === 'postgres') {
    await h.handle.db.execute(sql`delete from app_settings where key = 'study'`);
  }
  return withStudy(h);
}

export async function addPreset(h: StudyHarness, patch: Partial<PresetRow>): Promise<PresetRow> {
  const name = patch.name ?? `Preset ${(await h.store.listPresets()).length}`;
  const result = await createPreset(h.deps, { ...PRESET_INPUT, ...patch, name });
  if (!result.ok) {
    throw new Error(`preset setup failed: ${result.error}`);
  }
  return result.preset;
}

export async function addDeck(
  h: StudyHarness,
  name: string,
  options: { parentId?: string; presetId?: string } = {},
): Promise<DeckRow> {
  const result = await createDeck(h.deps, { name, ...options });
  if (!result.ok) {
    throw new Error(`deck setup failed: ${result.error}`);
  }
  return result.deck;
}

/** Adds a note through the domain service. Returns the card ids in template order. */
export async function addStudyNote(
  h: StudyHarness,
  deckId: string,
  fields: string[] = ['front', 'back'],
  noteTypeId: string = BASIC_ID,
): Promise<{ noteId: string; cardIds: string[] }> {
  const result = await createNote(h.deps, { noteTypeId, deckId, fields, tags: [] });
  if (!result.ok) {
    throw new Error(`note setup failed: ${result.error}`);
  }
  return { noteId: result.note.id, cardIds: result.note.cards.map((c) => c.id) };
}
