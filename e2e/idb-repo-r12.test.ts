import { test, expect, type Page } from '@playwright/test';

const handle = () => (window as any).__srepR12;

async function waitForHandle(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as any).__srepR12));
}

async function openRepo(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).__srepR12.open());
}

async function reloadAndOpen(page: Page): Promise<any> {
  await page.reload();
  await waitForHandle(page);
  return openRepo(page);
}

async function seedPack(page: Page, packId: string, cardCount: number): Promise<void> {
  const pack = {
    packId,
    serverRevision: 'r12-test',
    serverTimeMs: 1730000000000,
    serverTimeOffsetMs: 0,
    payload: {},
    cards: Array.from({ length: cardCount }, (_, i) => ({
      cardId: `card-${i}`,
      ordinal: i,
      reps: 0,
      payload: {},
    })),
  };

  await page.evaluate((arg) => (window as any).__srepR12.store_pack(arg), pack);
}

async function queue(
  page: Page,
  packId: string,
  cardId: string,
  rating = 3,
): Promise<any> {
  const review = {
    packId,
    cardId,
    rating,
    expectedReps: 0,
    elapsedMs: 100,
    clientOccurredAtMs: 1730000000000,
  };

  return page.evaluate(
    (arg) => (window as any).__srepR12.queue_review(arg),
    review,
  );
}

async function pendingOutbox(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any).__srepR12.pending_outbox());
}

async function getPack(page: Page, packId: string): Promise<any> {
  return page.evaluate(
    (id) => (window as any).__srepR12.get_pack(id),
    packId,
  );
}

async function rawIdb(page: Page, fnBody: string): Promise<void> {
  await page.evaluate((body) => {
    return new Promise<boolean>((resolve, reject) => {
      const req = indexedDB.open('srep-client', 1);

      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['outbox', 'packs', 'pack_cards'], 'readwrite');
        const fn = new Function('tx', 'db', body);

        try {
          fn(tx, db);
        } catch (e) {
          reject(e);
          return;
        }

        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => reject(tx.error);
      };

      req.onerror = () => reject(req.error);
    });
  }, fnBody);
}

async function quarantineMiddleOutboxRecord(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__srepR12.close());
  await rawIdb(
    page,
    "tx.objectStore('outbox').getAll().onsuccess = (e) => { const recs = e.target.result; const r = recs.find(x => x.seq === 2); delete r.cardId; tx.objectStore('outbox').put(r); };",
  );
}

test.describe.serial('R12 durable IndexedDB repository', () => {
  test.setTimeout(60_000);

  let initialOpenReport: any;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForHandle(page);
    await page.evaluate(() => (window as any).__srepR12.delete_database());
    initialOpenReport = await openRepo(page);
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate(() => (window as any).__srepR12.close());
  });

  test('fresh open creates stable device identity', async ({ page }) => {
    expect(initialOpenReport.deviceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const diagnostics = await page.evaluate(() =>
      (window as any).__srepR12.export_diagnostics(),
    );
    expect(diagnostics.meta.nextSeq).toBe(1);
    expect(diagnostics.meta.ackedThroughSeq).toBe(0);

    const reopenedReport = await reloadAndOpen(page);
    expect(reopenedReport.deviceId).toBe(initialOpenReport.deviceId);
  });

  test('queue order and reload persistence', async ({ page }) => {
    await seedPack(page, 'pack-a', 3);
    await queue(page, 'pack-a', 'card-0', 3);
    await queue(page, 'pack-a', 'card-1', 3);
    await queue(page, 'pack-a', 'card-2', 4);

    const before = await pendingOutbox(page);
    const deviceId = await page.evaluate(() =>
      (window as any).__srepR12.device_id(),
    );

    expect(before.map((record) => record.seq)).toEqual([1, 2, 3]);
    expect(new Set(before.map((record) => record.reviewId)).size).toBe(3);
    expect(before.every((record) => record.deviceId === deviceId)).toBe(true);
    expect(before.every((record) => record.sending === false)).toBe(true);

    const storedBefore = await getPack(page, 'pack-a');
    expect(storedBefore.cards).toHaveLength(3);
    expect(storedBefore.cards.every((card: any) => card.answered === true)).toBe(true);

    await reloadAndOpen(page);

    const after = await pendingOutbox(page);
    expect(after).toEqual(before);
    expect(after.map((record) => record.reviewId)).toEqual(
      before.map((record) => record.reviewId),
    );

    const storedAfter = await getPack(page, 'pack-a');
    expect(storedAfter.cards).toHaveLength(3);
    expect(storedAfter.cards.every((card: any) => card.answered === true)).toBe(true);
  });

  test('sending marker resets on reload', async ({ page }) => {
    await seedPack(page, 'pack-a', 1);
    const review = await queue(page, 'pack-a', 'card-0');

    await page.evaluate(
      (id) => (window as any).__srepR12.mark_sending([id], true),
      review.reviewId,
    );

    const reopenedReport = await reloadAndOpen(page);
    const pending = await pendingOutbox(page);

    expect(pending).toHaveLength(1);
    expect(pending[0].sending).toBe(false);
    expect(reopenedReport.recovery.sendingReset).toBe(1);
  });

  test('ack prefix removal preserves continuity and rejects non-prefix removal', async ({ page }) => {
    await seedPack(page, 'pack-a', 3);
    const first = await queue(page, 'pack-a', 'card-0');
    const second = await queue(page, 'pack-a', 'card-1');
    const third = await queue(page, 'pack-a', 'card-2');

    const removedPrefix = await page.evaluate(
      (ids) => (window as any).__srepR12.remove_acked(ids),
      [first.reviewId, second.reviewId],
    );
    expect(removedPrefix).toBe(2);

    const remaining = await pendingOutbox(page);
    expect(remaining.map((record) => record.reviewId)).toEqual([third.reviewId]);

    const diagnostics = await page.evaluate(() =>
      (window as any).__srepR12.export_diagnostics(),
    );
    expect(diagnostics.meta.ackedThroughSeq).toBe(2);

    const removedLast = await page.evaluate(
      (ids) => (window as any).__srepR12.remove_acked(ids),
      [third.reviewId],
    );
    expect(removedLast).toBe(1);
    expect(await pendingOutbox(page)).toEqual([]);

    const removedEmpty = await page.evaluate(() =>
      (window as any).__srepR12.remove_acked([]),
    );
    expect(removedEmpty).toBe(0);

    await seedPack(page, 'pack-b', 3);
    const j1 = await queue(page, 'pack-b', 'card-0');
    const j2 = await queue(page, 'pack-b', 'card-1');
    const j3 = await queue(page, 'pack-b', 'card-2');

    await expect(
      page.evaluate(
        (ids) => (window as any).__srepR12.remove_acked(ids),
        [j2.reviewId],
      ),
    ).rejects.toThrow();

    await expect(
      page.evaluate(
        (ids) => (window as any).__srepR12.remove_acked(ids),
        [j1.reviewId, j3.reviewId],
      ),
    ).rejects.toThrow();

    const stillPending = await pendingOutbox(page);
    expect(stillPending.map((record) => record.reviewId)).toEqual([
      j1.reviewId,
      j2.reviewId,
      j3.reviewId,
    ]);
  });

  test('malformed middle record is quarantined without wiping the prefix or tail', async ({ page }) => {
    await seedPack(page, 'pack-a', 3);
    await queue(page, 'pack-a', 'card-0');
    await queue(page, 'pack-a', 'card-1');
    await queue(page, 'pack-a', 'card-2');

    await quarantineMiddleOutboxRecord(page);
    const reopenedReport = await openRepo(page);
    const recovery = reopenedReport.recovery;

    expect(recovery.quarantinedOutbox).toBe(1);
    expect(recovery.validOutbox).toBe(1);
    expect(recovery.deferredOutbox).toBe(1);
    expect(recovery.usable).toBe(false);
    expect(recovery.gaps).toHaveLength(1);
    expect(recovery.gaps[0].expectedSeq).toBe(2);
    expect(recovery.gaps[0].foundSeq).toBe(3);

    const pending = await pendingOutbox(page);
    expect(pending).toHaveLength(1);
    expect(pending[0].seq).toBe(1);

    const diagnostics = await page.evaluate(() =>
      (window as any).__srepR12.export_diagnostics(),
    );
    expect(diagnostics.quarantine).toHaveLength(1);
    expect(diagnostics.quarantine[0].sourceStore).toBe('outbox');
    expect(diagnostics.quarantine[0].reason).toBe('requiredField');
  });

  test('gap blocks new queueing and hides the deferred tail', async ({ page }) => {
    await seedPack(page, 'pack-a', 3);
    await queue(page, 'pack-a', 'card-0');
    await queue(page, 'pack-a', 'card-1');
    await queue(page, 'pack-a', 'card-2');
    await seedPack(page, 'pack-new', 1);

    await quarantineMiddleOutboxRecord(page);
    await openRepo(page);

    await expect(queue(page, 'pack-new', 'card-0')).rejects.toThrow(/recovery/i);

    const pending = await pendingOutbox(page);
    expect(pending).toHaveLength(1);
    expect(pending[0].seq).toBe(1);
  });

  test('pack corruption discards only that pack while outbox reviews survive', async ({ page }) => {
    await seedPack(page, 'pack-a', 2);
    await seedPack(page, 'pack-b', 2);
    await queue(page, 'pack-a', 'card-0');
    await queue(page, 'pack-b', 'card-0', 4);

    await page.evaluate(() => (window as any).__srepR12.close());
    await rawIdb(
      page,
      "tx.objectStore('packs').getAll().onsuccess = (e) => { const packs = e.target.result; const p = packs.find(x => x.packId === 'pack-b'); p.payloadHash = '0'.repeat(64); tx.objectStore('packs').put(p); };",
    );

    const reopenedReport = await openRepo(page);
    expect(reopenedReport.recovery.discardedPackIds).toContain('pack-b');
    expect(reopenedReport.recovery.discardedPackIds).not.toContain('pack-a');

    expect(await getPack(page, 'pack-a')).not.toBeNull();
    expect(await getPack(page, 'pack-b')).toBeNull();

    const pending = await pendingOutbox(page);
    expect(pending).toHaveLength(2);
    expect(pending.map((record) => record.seq)).toEqual([1, 2]);
  });
});
