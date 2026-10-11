// Drizzle wraps driver errors. The driver error is in `cause`.
function* chain(error: unknown): Generator<Record<string, unknown>> {
  let current = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const record = current as Record<string, unknown>;
    yield record;
    current = record.cause;
  }
}

// The error codes come from the driver. The message text is never matched.
export function isSqliteUniqueViolation(error: unknown): boolean {
  for (const record of chain(error)) {
    if (
      record.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      record.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
    ) {
      return true;
    }
  }
  return false;
}

// SQLSTATE 23505 is unique_violation.
export function isPgUniqueViolation(error: unknown): boolean {
  for (const record of chain(error)) {
    if (record.code === '23505') {
      return true;
    }
  }
  return false;
}
