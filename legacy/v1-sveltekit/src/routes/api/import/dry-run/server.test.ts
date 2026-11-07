import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.js', async () => {
  const { browseHandle } = await import('#lib/server/browse/test-handle.js');
  return { getDb: () => browseHandle() };
});
vi.mock('#lib/server/domain/context.js', async () => {
  const { domainRouteState } = await import('#lib/server/domain/test-support/route-support.js');
  return { getDomainContext: () => domainRouteState.deps };
});

import { setBrowseHandle } from '#lib/server/browse/test-handle.js';
import { SESSION } from '#lib/server/domain/test-support/route-support.js';
import { addDeck, addStudyNote } from '#lib/server/study/test-support/harness.js';
import { useStudyRouteContext } from '#lib/server/study/test-support/route-support.js';
import { exportNativeArchive } from '#lib/server/import-export/native.js';
import { getSnapshotStore } from '#lib/server/import-export/snapshot-store.js';
import type { StudyHarness } from '#lib/server/study/test-support/harness.js';
import { POST } from './+server';

let h: StudyHarness | undefined;

afterEach(async () => {
  setBrowseHandle(undefined);
  await h?.close();
  h = undefined;
});

async function open(): Promise<StudyHarness> {
  h = await useStudyRouteContext();
  setBrowseHandle(h.handle);
  return h;
}

describe('POST /api/import/dry-run', () => {
  it('dry-runs a native archive', async () => {
    const harness = await open();
    const deck = await addDeck(harness, 'ImportRoute');
    await addStudyNote(harness, deck.id, ['in', 'out']);
    const deps = {
      snapshot: getSnapshotStore(harness.handle),
      domain: harness.deps,
      now: () => harness.clock.now,
      importMaxBytes: 50_000_000,
    };
    const archive = await exportNativeArchive(deps);
    const url = new URL('http://localhost:3000/api/import/dry-run');
    const request = new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: new Uint8Array(archive),
    });
    const event = {
      request,
      url,
      locals: { session: SESSION },
      cookies: { get: () => undefined, set: () => undefined },
    } as unknown as RequestEvent;
    const response = await POST(event as Parameters<typeof POST>[0]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { report: { format: string; importToken: string } };
    expect(body.report.format).toBe('native');
    expect(body.report.importToken.length).toBeGreaterThan(10);
  });
});
