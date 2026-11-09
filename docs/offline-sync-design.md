# Offline reviewing with sync — design

Status: **design only** (Kimi design round, Nov 8, 2026). No implementation in this
round except the milestone plan. Branch: `kimi/offline-sync-design`.

## Principles

1. **Server history is authoritative.** The client keeps an offline pack plus an
   outbox, never a general card replica. The server's `review_log` remains the
   source of truth; card state is a cache rebuilt by replaying it.
2. **The append-only log is never rewritten by sync.** No backdating, no
   insertion into the log. Offline reviews are applied at upload time (see OQ1).
3. **Nothing is silently dropped.** A review that cannot be applied stays
   visible as a conflict. A receipt means "this upload was processed", not
   "this review remains applied" (undo can remove it afterwards — see §4).
4. **One pending review per card at a time** (first version). No offline FSRS
   implementation and no dependent same-card chains.

## Verified ground truth (read in-tree Nov 8, 2026)

- Study API: `GET /api/study/next`, `POST /api/study/answer`
  `{card_id, rating, reps, elapsed_ms}` (`reps` = expected reps; mismatch →
  `409 stale_card`), `POST /api/study/undo` (undoes the single **global** last
  review), `POST /api/study/verify` / `/api/study/rebuild` (replay `review_log`
  per card through FSRS and compare to cached card state), `GET/PUT
  /api/settings/study`. Auth: session cookie **or** bearer token (iOS pairing).
- One answer = one DB transaction: check `reps`, compute FSRS, append one
  `review_log` row, update the card cache, optionally bury siblings.
  `review_log` rows carry `*_before` fields (state/due/stability/difficulty/
  last_review/reps/lapses/step), `reviewed_at` (ms), `rating`, `elapsed_ms`,
  `interval_after`, `buried_sibling_ids`.
- Server forces `reviewed_at` strictly increasing globally:
  `reviewed_at = max(now, MAX(reviewed_at)+1)`.
- On Postgres every answer/undo transaction takes
  `pg_advisory_xact_lock(7303301)`; SQLite serializes writers natively.
- Undo deletes the latest log row (`ORDER BY reviewed_at DESC, id DESC
  LIMIT 1`) and restores `*_before`; it unburies siblings.
- Daily limits are per-deck quotas (`new_per_day`, `reviews_per_day`) counted
  from today's `review_log`; the day window is a configurable rollover hour
  (default 04:00) + timezone.
- `verify`/`rebuild` give a ready-made sync-integrity oracle: after sync,
  replay must match cached state.
- Frontend (Leptos WASM): `api.rs` is plain `window.fetch`, no retry or queue.
  No IndexedDB / localStorage / Cache API use anywhere. **No service worker
  exists in the repo** (ROADMAP M8 claims one that caches static assets — it
  is not there). Manifest exists, display standalone.
- **The study screen is a placeholder** (`frontend/src/screens/study.rs`
  never calls `/api/study/next`). E2E tests expect a real study UI
  (`.study-card`, edit dialog, commands). The real online study screen is
  still to be built; offline support is designed into it, not bolted on later.
- No sync or conflict machinery exists. Export does not include `review_log`.

## 1. Durable local queue

- **IndexedDB**, owned by the WASM app. `localStorage` lacks transactions and
  capacity; Cache Storage is for HTTP/app-shell resources, not review history.
- Object stores: `meta` (device UUID, next sequence, schema version),
  `packs` / `pack_cards`, `outbox`, `conflicts`. Request persistent browser
  storage, but treat only a server acknowledgement as durable sync.
- Each outbox item: `review_id` UUID, `device_id`, monotonic `seq`, `pack_id`,
  `card_id`, `rating`, expected `reps`, `elapsed_ms`, raw
  `client_occurred_at` (ms), pack server-time/offset estimate, payload schema
  version.
- Allocate `seq`, insert the review, and mark the pack card answered in **one
  IDB transaction**. Advance the study UI only after that transaction commits.
- Ordering is `(device_id, seq)`, never client wall time.
- `review_id` is stable across retries; re-sending it must never create a new
  logical review.

## 2. Building the offline queue

- New authenticated `GET /api/study/offline-pack?limit=N`, using the same deck
  eligibility, due-card, sibling, and daily-limit selection as `/study/next`.
- Response: `pack_id`, generation/server time, day-window configuration, quota
  snapshot, and ordered cards with full study content, `card_id`, expected
  `reps`, and scheduling metadata for display.
- **50 cards, capped by remaining eligibility/quotas**, as the test/MVP pack
  size. A pack is a snapshot, not a quota reservation; another device may
  consume those quotas.
- Pack age alone does not invalidate a review. Display `generated_at`;
  scheduling staleness is detected by `reps` at upload. Refill only from a
  fresh server response, excluding locally answered cards.
- Decided Nov 8, 2026 (see Decisions): pack size 50; new cards eligible;
  learning cards eligible but do not requeue offline (they advance one step
  and wait for sync to requeue them); show a warning when a pack is more
  than a day old, no hard expiry.

## 3. Sync protocol and server application

- New `POST /api/study/sync`: `{device_id, items: [...]}`, at most 50 items in
  sequence order. Auth unchanged; `device_id` scopes idempotency, it is not
  identity.
- Process items in request order, **one existing answer-style DB transaction
  per item**, not an all-or-nothing batch. Reuse the `reps` check, FSRS, log
  append, card-cache update, and sibling burying.
- Preserve `reviewed_at = max(server_now, MAX(reviewed_at)+1)`. Serialize
  log-head allocation across concurrent writers by taking the same
  `pg_advisory_xact_lock(7303301)` **per item** (SQLite's writer
  serialization is the equivalent). Do not hold the lock across the whole
  batch: 50 short per-item transactions may queue, but a batch-held lock would
  block online study and lengthen failure/timeout windows. No deadlock: each
  transaction acquires only that one lock.
- For the first implementation, FSRS treats the review as occurring when
  applied; retain `client_occurred_at` as audit metadata. Offline intervals
  are therefore rebased to upload time, and existing verify/rebuild semantics
  stay valid.
- Decided Nov 8, 2026 (see Decisions): upload-time scheduling for v1
  (deterministic, authoritative, independent of device clocks). Scheduling
  from actual offline time would first need a separate effective timestamp
  and consistent changes to apply, per-card ordering, replay/rebuild, undo,
  and statistics; do not overload `reviewed_at`.
- Durable `sync_receipts` table, keyed by `(device_id, review_id)`, holding
  request hash and terminal outcome/log id. Write the receipt in the same
  transaction as the review or rejection.
- Identical retries return the original outcome; the same key with a different
  payload returns `idempotency_mismatch`. Receipts survive undo and rebuild.
- Response carries per-item `accepted`, `duplicate`, `stale_card`, `invalid`,
  `blocked`, or `not_attempted`, plus server time, log head, and authoritative
  state for affected cards.
- Uploads are **not** rejected because a quota is now exhausted: the review
  already happened. Quotas govern subsequent `/next` selection.
- Decided Nov 8, 2026 (see Decisions): late reviews count on their arrival
  day and reduce today's remaining quota. Original-day accounting would also
  need a clock-skew policy and an explicit choice of current vs pack-time
  timezone/rollover configuration.

## 4. Conflicts and undo

- Reuse the existing optimistic `reps` check. A mismatch yields an item-level
  `stale_card` result; the whole batch is not HTTP 409.
- For two devices reviewing one card, the first successfully committed review
  wins. The other does not overwrite or automatically rebase against newer
  FSRS state.
- A stale item stays durably in `conflicts` with its original payload and the
  returned server snapshot. Later items for that card are `blocked`;
  independent cards may proceed. Nothing is silently discarded or marked
  synced.
- Decided Nov 8, 2026 (see Decisions): per-conflict choice — manual "append
  anyway" using a new operation id and current reps, or explicit discard with
  confirmation. Automatic last-write-wins is not safe.
- Do not queue calls to the existing global `/undo`. Online undo continues to
  remove whichever review is globally latest, including a synced review.
- **Receipt ≠ still applied.** Sequence: device A syncs review R (receipt
  accepted) but loses the response; online undo deletes R's log row and
  restores the card (receipt remains); A retries R and gets the stored receipt
  without R being reapplied. The online UI shows the card restored; A may
  temporarily show R as done from local state. On the next pull the client
  must treat server card/log state as authoritative (including undo/tombstone
  or history-cursor information), mark R superseded/undone, clear its done
  presentation, and never retry it as a new review.
- **Implemented (R17, Nov 9, 2026).** Server: `undo_events` table (`log_id`,
  `card_id`, `undone_at` = server time at undo, written in the same
  transaction as the log-row delete) plus `GET /api/study/undo-events?since=<ms>`
  returning `{undoneLogIds, logHead, serverTime}`. Client: a durable
  `acked_reviews` ledger (one entry per server-accepted review, recorded
  before the outbox record is deleted) plus a `sync_cursors` undo cursor.
  On every online study load the client drains, then reconciles: tombstones
  supersede the ledger entries (terminal) and unmark the pack cards, so the
  offline view stops showing them as "Queued for sync". The cursor advances
  to the response's server time, so each tombstone is seen at most once; a
  first-ever reconcile queries `since=0`. A failed reconcile is log-only and
  never blocks study. Tombstones are never pruned in v1 (the server cannot
  know every client's cursor).
- Decided Nov 8, 2026 (see Decisions): offline users may cancel the latest
  unsent review. No additional cross-device/targeted undo UX for v1. Undo of
  unseen pending reviews is impossible.

## 5. Reconnect and partial failure

- On startup and `online`, recover IDB state, authenticate, then upload
  pending items **before** issuing new online answers or replacing the pack.
  Do not rely solely on `navigator.onLine`.
- One outstanding batch per device. On failure, retry the same batch and ids;
  committed items return as duplicates.
- Remove outbox items only for matching accepted/duplicate receipts. Park
  conflicts; leave unacknowledged items pending. A lost response therefore
  cannot duplicate or lose reviews.
- Retry network errors, 429, and 5xx with capped exponential backoff and
  jitter. Stop on authentication failure; never blindly retry stale/invalid
  items.
- After draining, apply returned card snapshots, then call `/study/next` and
  fetch a fresh pack. This supplies current counts, quotas, day window, and
  server-moved state without full-database replication.

## 6. Failure handling

- **Crash:** before the IDB commit, the same card remains unanswered; after
  it, restart restores the outbox and answered state. Reset any `sending`
  markers on startup.
- **Corruption:** validate schema, required fields, ids, sequence continuity,
  and payload hashes. Quarantine malformed records, stop at ordering gaps,
  and retain an exportable diagnostic payload; never wipe the whole outbox
  automatically.
- **Clock skew:** sequence numbers order reviews. Under upload-time
  scheduling, client clocks cannot alter FSRS or log ordering; record server
  offset for diagnostics. OQ2 decided Nov 8, 2026 (see Decisions): late
  reviews count on arrival day.
- **Duplicates:** handled end-to-end by durable receipts, including response
  loss, browser restart, server retry, and undo.
- **Pack corruption:** discard only the unusable pack; valid outbox reviews
  remain uploadable.

## 7. Service worker versus WASM

- The service worker precaches a versioned HTML/JS/WASM/CSS/icons shell and
  provides navigation fallback. Activate updates only after a complete shell
  is cached, without deleting IDB.
- It does not own reviews, assign sequence numbers, apply FSRS, or cache
  authenticated study API responses. Pack and outbox data stay in IDB.
- WASM owns pack storage, answering, sync, backoff, conflict handling, and
  refresh. Background Sync may be an optional wakeup enhancement, but offline
  upload is never guaranteed while the app is closed.

## Milestones (R11–R17)

**R11 — Real online study vertical slice.**
Build the study screen around `/next`, `/answer`, `/undo`, and explicit
stale-card handling, with a controller seam for later offline storage.
*Gate:* E2E covers due-card display, answer/count updates, 409 recovery,
undo, and empty-queue behavior.

**R11a — Smallest first implementation slice (recommended next step).**
Load one due card into a real `.study-card`, submit one answer through the
existing online endpoint, and advance/refresh. Defer editing, commands, and
offline behavior.
*Gate:* one browser E2E proving the card renders, the answer persists a
log/card update, and study state advances, with existing server tests green.

**R12 — Durable client repository.**
Versioned IDB stores, device identity, atomic sequencing, recovery, and
validation; no offline claims yet. No inherent dependency on R11 — can be
built in parallel behind the repository interface with contract tests.
*Gate:* browser crash/reload tests preserve exact order and pending counts;
corruption tests quarantine without wiping valid items.

**R13 — Offline shell and read-only pack.**
Service worker plus the pack endpoint; populate packs from the real study
controller.
*Gate:* after one online load, a cold offline launch displays the exact pack;
SW upgrades preserve IDB and no authenticated API response is cached.

**R14 — Offline answering behind a feature flag.**
Atomically queue answers and advance through the pack; show pending state.
*Gate:* with networking blocked, 50 answers survive repeated reloads without
duplication/reordering and cause zero server mutations.

**R15 — Idempotent server sync.**
Receipts, sync metadata, per-item transactions, batch results, and concurrent
log-head handling.
*Gate:* SQLite and Postgres integration tests cover duplicates, payload
mismatch, partial batches, stale reps, concurrent monotonic timestamps,
undo-then-retry, and verify/rebuild equivalence.

**R16 — Reconnect and conflict recovery.**
Backoff, acknowledgement reconciliation, authoritative refresh, and durable
conflict presentation.
*Gate:* fault injection after every item and at every lost-response point
yields no silent loss or duplicate; two-device same-card and
independent-card cases pass.

**R17 — Product semantics and release hardening.**
OQ1–OQ5 decided Nov 8, 2026 (see Decisions); implement the approved
timestamp/quota/undo behavior, and test
skew, storage eviction, SW upgrades, and long-lived packs.
*Gate:* product acceptance plus end-to-end offline → restart → partial sync
→ undo → rebuild, with documented day-window and quota results.
*Implemented Nov 9, 2026 (PR #50):* undo tombstones + acked-review ledger +
undo cursor (§4); OQ1/OQ2 covered by the upload-time scheduling already in
R15, with tests for ±2-day client skew and the arrival-day quota; the
04:00 day-window rollover is tested at the boundary; SW upgrade with a
pending review is tested (the review still drains after the upgrade);
long-lived-pack warning is tested end-to-end; diagnostics now carry
persistence, per-review clock-skew offsets, ledger counts, and the cursor,
and Settings surfaces them. The online answer path now shares the sync
path's process-wide SQLite write mutex (the busy-collision follow-up from
PR #42). Not in R17: the `srep-browse` `fetch_pg` jsonb decode (browse
path, reported as a follow-up) and server-side sanitization (explicitly
out of v1 scope per Decisions).

## Decisions (Sam, Nov 8, 2026)

- **OQ1 — Upload-time scheduling.** Reviews schedule from when they reach
  the server. Scheduling from actual offline time was rejected for v1 (would
  need a separate effective timestamp across apply, replay, undo, and stats).
- **OQ2 — Arrival day.** Late reviews count on their arrival day and reduce
  today's remaining quota.
- **OQ3 — Pack: 50 cards; new cards eligible; learning cards eligible but do
  not requeue offline** (they advance one step and wait for sync to requeue
  them). Warn when a pack is more than a day old; no hard expiry — pack age
  alone does not invalidate a review.
- **OQ4 — Per-conflict choice.** On conflict the user picks "append anyway"
  (new operation id, current reps) or explicit discard with confirmation.
  Nothing is silently dropped; no automatic last-write-wins.
- **OQ5 — Cancel the latest unsent review: yes.** No additional
  cross-device/targeted undo UX for v1.
- **Sanitization — allow images.** The card sanitizer's minimal allowlist
  gains `<img>` (`src`, `alt`; http/https only, no event handlers, no
  `javascript:`/`data:` URLs). Server-side sanitization is deferred
  hardening, not v1 scope. See `frontend/src/sanitize.rs`.

## Riskiest unknowns

- Upload-time versus actual-time FSRS semantics; changing later affects
  replay, undo, statistics, and quotas.
- Global timestamp serialization under concurrent Postgres writers and large
  batches (mitigated by the per-item advisory lock, §3).
- The receipt/undo divergence (§4): clients must reconcile against
  authoritative server state, which needs an undo/tombstone or history-cursor
  signal that does not exist yet.
- Storage eviction: browsers can evict IndexedDB under storage pressure;
  pending reviews are only safe once the server acknowledges them.
- The study screen itself is unfinished; R11a is the real starting line, and
  offline work cannot be tested end-to-end until it exists.
