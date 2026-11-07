import type { PgTransactionConfig } from 'drizzle-orm/pg-core';

export const PG_READ_SNAPSHOT: PgTransactionConfig = {
  isolationLevel: 'repeatable read',
  accessMode: 'read only',
};
