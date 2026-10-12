// Contract: the Postgres transaction config for read-only study reads.
// The default level (read committed) gives each statement its own snapshot. A read of
// cards and then of their logs could see an answer between the two statements.
// Repeatable read gives all statements of the transaction one snapshot.
import type { PgTransactionConfig } from 'drizzle-orm/pg-core';

export const PG_READ_SNAPSHOT: PgTransactionConfig = {
  isolationLevel: 'repeatable read',
  accessMode: 'read only',
};
