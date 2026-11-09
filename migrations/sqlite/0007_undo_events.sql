-- R17: undo tombstones. The client keeps a durable acked-review ledger and
-- reconciles against this table on pull, so an undone review never
-- resurrects a stale "queued for sync" card state.
CREATE TABLE IF NOT EXISTS undo_events (
  log_id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  undone_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_undo_events_undone_at ON undo_events (undone_at);
