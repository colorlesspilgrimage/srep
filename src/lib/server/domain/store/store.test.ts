import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { defineDomainStoreSuite } from '#lib/server/domain/store/store.suite.js';
import {
  createDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';

describe('domain store (sqlite)', () => {
  defineDomainStoreSuite(() => createDomainHarness());
});

describe('domain indexes (sqlite)', () => {
  let h: DomainHarness | undefined;
  afterEach(async () => {
    await h?.close();
  });

  it('creates the unique and secondary indexes', async () => {
    h = await createDomainHarness();
    if (h.handle.dialect !== 'sqlite') {
      throw new Error('expected sqlite');
    }
    const rows = h.handle.db.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'index'`,
    );
    const names = rows.map((r) => r.name);
    for (const name of [
      'card_deck_state_due_idx',
      'card_note_template_ordinal_idx',
      'note_tag_tag_idx',
      'deck_path_unique',
      'deck_parent_id_idx',
      'note_checksum_idx',
      'review_log_card_idx',
      'review_log_reviewed_at_idx',
    ]) {
      expect(names).toContain(name);
    }
  });
});
