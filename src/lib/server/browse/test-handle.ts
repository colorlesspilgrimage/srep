// Contract: test slot for the database handle.
// Route tests call setBrowseHandle. Production code does not import this file.
// browseHandle throws when the slot is empty.

import type { DbHandle } from '#lib/server/db/client.js';

let current: DbHandle | undefined;

export function setBrowseHandle(handle: DbHandle | undefined): void {
  current = handle;
}

export function browseHandle(): DbHandle {
  if (current === undefined) throw new Error('missing browse handle');
  return current;
}
