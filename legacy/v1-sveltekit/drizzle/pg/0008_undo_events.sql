-- R17: undo tombstones. The client keeps a durable acked-review ledger and
-- reconciles against this table on pull, so an undone review never
-- resurrects a stale "queued for sync" card state.
-- log_id/card_id are TEXT to match review_log.id / card.id on Postgres.
CREATE TABLE IF NOT EXISTS undo_events (
  log_id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  undone_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_undo_events_undone_at ON undo_events (undone_at);
