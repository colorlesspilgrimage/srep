import { afterEach, describe, expect, it } from 'vitest';
import {
  createDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';
import { BASIC_ID } from '#lib/server/domain/builtin.js';
import { createNote } from '#lib/server/domain/notes.js';
import { addDeck, createStudyHarness } from '#lib/server/study/test-support/harness.js';
import { getSnapshotStore } from '#lib/server/import-export/snapshot-store.js';
import { clearPendingImports } from '#lib/server/import-export/pending-imports.js';
import {
  exportNativeArchive,
  planNativeImport,
  applyPendingNative,
} from '#lib/server/import-export/native.js';
import { buildMinimalApkg } from '#lib/server/import-export/test-support/apkg-fixture.js';
import { planApkgImport } from '#lib/server/import-export/apkg/import.js';
import { takePending } from '#lib/server/import-export/pending-imports.js';
import type { ImportExportDeps } from '#lib/server/import-export/deps.js';
import { unpackNativeArchive } from '#lib/server/import-export/zip-archive.js';

let harness: DomainHarness | undefined;

afterEach(async () => {
  clearPendingImports();
  await harness?.close();
  harness = undefined;
});

function depsOf(h: DomainHarness): ImportExportDeps {
  return {
    snapshot: getSnapshotStore(h.handle),
    domain: h.deps,
    now: () => h.clock.now,
    importMaxBytes: 50_000_000,
  };
}

describe('native import-export', () => {
  it('round-trips user content', async () => {
    const studyHarness = await createStudyHarness();
    harness = studyHarness;
    const deck = await addDeck(studyHarness, 'RoundTrip');
    const created = await createNote(studyHarness.deps, {
      noteTypeId: BASIC_ID,
      deckId: deck.id,
      fields: ['hello', 'world'],
      tags: ['tag-a'],
    });
    expect(created.ok).toBe(true);

    const deps = depsOf(harness);
    const archive = await exportNativeArchive(deps);
    const unpacked = unpackNativeArchive(archive);
    expect(unpacked.manifest.notes.some((note) => note.fields[0] === 'hello')).toBe(true);

    const second = await createDomainHarness();
    const secondDeps = depsOf(second);
    const dry = await planNativeImport(secondDeps, archive);
    expect('importToken' in dry).toBe(true);
    if (!('importToken' in dry)) {
      return;
    }
    const pending = takePending(dry.importToken, secondDeps.now());
    expect(pending).toBeDefined();
    await applyPendingNative(secondDeps, pending!.manifest, pending!.mediaFiles);
    const decks = await second.store.listDecks();
    expect(decks.some((row) => row.path === 'RoundTrip')).toBe(true);
    await second.close();
  });
});

describe('apkg import', () => {
  it('imports a minimal generated deck', async () => {
    harness = await createDomainHarness();
    const apkg = buildMinimalApkg({ front: 'Apkg front', back: 'Apkg back', deckName: 'ApkgDeck' });
    const deps = depsOf(harness);
    const dry = await planApkgImport(deps, apkg);
    expect('importToken' in dry).toBe(true);
    if (!('importToken' in dry)) {
      return;
    }
    const pending = takePending(dry.importToken, deps.now());
    await applyPendingNative(deps, pending!.manifest, pending!.mediaFiles);
    const decks = await harness.store.listDecks();
    expect(decks.some((row) => row.path === 'ApkgDeck')).toBe(true);
  });
});
