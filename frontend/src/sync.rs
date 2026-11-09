//! Reconnect synchronisation (R16).
//!
//! Retry policy: five HTTP attempts per trigger, including the initial
//! attempt. The delay before retry N is 1000ms * 2^N, capped at 30000ms,
//! with ±25% jitter. Thus the nominal delays are 1s, 2s, 4s, and 8s before
//! the final attempt. Nothing is removed from the outbox on transport or
//! server failure; committed items come back as duplicates on retry.

use std::cell::RefCell;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};

use leptos::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::{spawn_local, JsFuture};

use crate::api;
use crate::repository::idb::ClientRepository;
use crate::repository::model::{ConflictRecord, OutboxRecord, SyncOutcome, SyncOutcomeKind};
use crate::sanitize;

pub const SREP_DRAINED_EVENT: &str = "srep:r16-drained";

const MAX_BATCH_SIZE: usize = 50;
const MAX_ATTEMPTS: u32 = 5;
const BACKOFF_BASE_MS: u32 = 1_000;
const BACKOFF_CAP_MS: u32 = 30_000;
const MAX_REPORT_HISTORY: usize = 20;

static DRAIN_RUNNING: AtomicBool = AtomicBool::new(false);
static DRAIN_AGAIN: AtomicBool = AtomicBool::new(false);

thread_local! {
    static LAST_REPORT: RefCell<Option<SyncReport>> = const { RefCell::new(None) };
    static REPORT_HISTORY: RefCell<Vec<SyncReport>> = const { RefCell::new(Vec::new()) };
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SyncStatus {
    Drained,
    Empty,
    Failed { reason: String },
    AuthFailed,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    /// Number of outbox items in the selected batch, not the number of HTTP attempts.
    pub attempted: usize,
    /// Items newly accepted by the server.
    pub acked: usize,
    /// Items acknowledged as duplicates whose original outcome was accepted.
    pub duplicates: usize,
    pub conflicts_parked: usize,
    pub left_pending: usize,
    pub status: SyncStatus,
    pub server_time_ms: Option<i64>,
    pub log_head: Option<Value>,
}

impl SyncReport {
    fn empty() -> Self {
        Self {
            attempted: 0,
            acked: 0,
            duplicates: 0,
            conflicts_parked: 0,
            left_pending: 0,
            status: SyncStatus::Empty,
            server_time_ms: None,
            log_head: None,
        }
    }

    fn failed(attempted: usize, left_pending: usize, reason: impl Into<String>) -> Self {
        Self {
            attempted,
            acked: 0,
            duplicates: 0,
            conflicts_parked: 0,
            left_pending,
            status: SyncStatus::Failed {
                reason: reason.into(),
            },
            server_time_ms: None,
            log_head: None,
        }
    }

    fn auth_failed(attempted: usize, left_pending: usize) -> Self {
        Self {
            attempted,
            acked: 0,
            duplicates: 0,
            conflicts_parked: 0,
            left_pending,
            status: SyncStatus::AuthFailed,
            server_time_ms: None,
            log_head: None,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncResponse {
    results: Vec<Value>,
    server_time: i64,
    log_head: Value,
}

#[derive(Debug)]
struct ResolvedPrefix {
    outcomes: Vec<SyncOutcome>,
    accepted: usize,
    duplicates: usize,
    conflicts: usize,
}

pub fn last_report() -> Option<SyncReport> {
    LAST_REPORT.with(|slot| slot.borrow().clone())
}

/// Every drain report, oldest first, capped. The load effect re-drains on
/// refresh, so the most recent report alone cannot prove an earlier drain's
/// outcome; tests assert against this history.
pub fn reports() -> Vec<SyncReport> {
    REPORT_HISTORY.with(|slot| slot.borrow().clone())
}

fn remember_report(report: &SyncReport) {
    LAST_REPORT.with(|slot| {
        *slot.borrow_mut() = Some(report.clone());
    });
    REPORT_HISTORY.with(|slot| {
        let mut history = slot.borrow_mut();
        history.push(report.clone());
        if history.len() > MAX_REPORT_HISTORY {
            let excess = history.len() - MAX_REPORT_HISTORY;
            history.drain(..excess);
        }
    });
}

fn announce_report() {
    if let Some(window) = web_sys::window() {
        if let Ok(event) = web_sys::Event::new(SREP_DRAINED_EVENT) {
            let _ = window.dispatch_event(&event);
        }
    }
}

/// Sleep without a timer crate: a setTimeout-backed promise.
async fn sleep_ms(ms: u32) {
    let promise = js_sys::Promise::new(&mut |resolve, _reject| {
        if let Some(window) = web_sys::window() {
            let closure = wasm_bindgen::closure::Closure::once(move || {
                let _ = resolve.call0(&JsValue::UNDEFINED);
            });
            let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(
                closure.as_ref().unchecked_ref(),
                ms as i32,
            );
            closure.forget();
        } else {
            let _ = resolve.call0(&JsValue::UNDEFINED);
        }
    });
    let _ = JsFuture::from(promise).await;
}

/// Run a drain, coalescing triggers which arrive while another drain is active.
///
/// Every caller waits until the active drain, including its one coalesced
/// rerun, has finished. The returned value is the most recent report.
pub async fn drain_outbox() -> SyncReport {
    drain_outbox_with(MAX_ATTEMPTS).await
}

/// The load-effect drain: one attempt, no retries. The load effect must
/// never block the offline fallback on a retry loop — a single fast-failing
/// request is enough to learn the server is unreachable, and the
/// online-event drain (full retries) picks the batch up later. When the
/// server is reachable the single attempt is the normal path and
/// drain-before-next holds exactly.
pub async fn drain_outbox_fail_fast() -> SyncReport {
    drain_outbox_with(1).await
}

async fn drain_outbox_with(max_attempts: u32) -> SyncReport {
    if DRAIN_RUNNING.swap(true, Ordering::SeqCst) {
        DRAIN_AGAIN.store(true, Ordering::SeqCst);

        while DRAIN_RUNNING.load(Ordering::SeqCst) {
            sleep_ms(25).await;
        }

        return last_report().unwrap_or_else(SyncReport::empty);
    }

    DRAIN_AGAIN.store(false, Ordering::SeqCst);

    let mut budget = max_attempts;
    let report = loop {
        let report = drain_pass(budget).await;
        remember_report(&report);

        if !DRAIN_AGAIN.swap(false, Ordering::SeqCst) {
            break report;
        }
        // A coalesced rerun does the full job, even if the drain that was
        // already running was fail-fast.
        budget = MAX_ATTEMPTS;
    };

    // There is no await between clearing DRAIN_AGAIN and clearing
    // DRAIN_RUNNING, so another wasm task cannot interleave here and strand
    // a coalesced request.
    DRAIN_RUNNING.store(false, Ordering::SeqCst);
    announce_report();
    report
}

async fn drain_pass(max_attempts: u32) -> SyncReport {
    let (repo, _) = match ClientRepository::open().await {
        Ok(opened) => opened,
        Err(error) => {
            return SyncReport::failed(0, 0, format!("could not open repository: {error}"));
        }
    };

    let pending = match repo.pending_outbox().await {
        Ok(pending) => pending,
        Err(error) => {
            repo.close();
            return SyncReport::failed(0, 0, format!("could not read outbox: {error}"));
        }
    };

    if pending.is_empty() {
        repo.close();
        return SyncReport::empty();
    }

    let conflicted_cards: HashSet<String> = match repo.list_conflicts().await {
        Ok(conflicts) => conflicts
            .into_iter()
            .map(|conflict| conflict.card_id)
            .collect(),
        Err(error) => {
            repo.close();
            return SyncReport::failed(
                0,
                pending.len(),
                format!("could not read conflicts: {error}"),
            );
        }
    };

    let batch: Vec<OutboxRecord> = pending
        .iter()
        .filter(|record| !conflicted_cards.contains(&record.card_id))
        .take(MAX_BATCH_SIZE)
        .cloned()
        .collect();

    // All currently sendable items can be excluded by existing conflicts.
    if batch.is_empty() {
        repo.close();
        return SyncReport {
            attempted: 0,
            acked: 0,
            duplicates: 0,
            conflicts_parked: 0,
            left_pending: pending.len(),
            status: SyncStatus::Drained,
            server_time_ms: None,
            log_head: None,
        };
    }

    let batch_ids: Vec<String> = batch
        .iter()
        .map(|record| record.review_id.clone())
        .collect();

    if let Err(error) = repo.mark_sending(&batch_ids, true).await {
        repo.close();
        return SyncReport::failed(
            batch.len(),
            pending.len(),
            format!("could not mark batch sending: {error}"),
        );
    }

    let body = json!({
        "deviceId": repo.device_id(),
        "items": batch.iter().map(|record| {
            json!({
                "reviewId": record.review_id,
                "cardId": record.card_id,
                "rating": record.rating,
                "reps": record.expected_reps,
                "elapsedMs": record.elapsed_ms,
                "clientOccurredAt": record.client_occurred_at_ms,
            })
        }).collect::<Vec<_>>()
    });

    let response = {
        let mut attempt: u32 = 1;
        loop {
            match api::post_json_csrf::<SyncResponse, _>("/api/study/sync", &body).await {
                Ok(response) => break response,
                Err(error) => {
                    let _ = repo.mark_sending(&batch_ids, false).await;

                    if error.status == 401 || error.status == 403 {
                        repo.close();
                        return SyncReport::auth_failed(batch.len(), pending.len());
                    }

                    if error.status == 400 {
                        repo.close();
                        return SyncReport::failed(
                            batch.len(),
                            pending.len(),
                            format!("bad request; batch left pending: {}", error.body),
                        );
                    }

                    let retryable = error.status == 0
                        || error.status == 429
                        || (500..=599).contains(&error.status);

                    if retryable && attempt < max_attempts {
                        let delay = backoff_delay_ms(attempt - 1, js_sys::Math::random());
                        sleep_ms(delay).await;

                        if let Err(mark_error) = repo.mark_sending(&batch_ids, true).await {
                            repo.close();
                            return SyncReport::failed(
                                batch.len(),
                                pending.len(),
                                format!("could not restore sending markers: {mark_error}"),
                            );
                        }

                        attempt += 1;
                        continue;
                    }

                    let reason = if retryable {
                        format!(
                            "sync failed after {attempt} attempts; batch left pending: {}",
                            error.body
                        )
                    } else {
                        format!(
                            "sync returned HTTP {}; batch left pending: {}",
                            error.status, error.body
                        )
                    };

                    repo.close();
                    return SyncReport::failed(batch.len(), pending.len(), reason);
                }
            }
        }
    };

    let prefix = resolved_prefix(&batch_ids, &response.results);

    if !prefix.outcomes.is_empty() {
        if let Err(error) = repo.apply_sync_outcome(&prefix.outcomes).await {
            let _ = repo.mark_sending(&batch_ids, false).await;
            repo.close();
            return SyncReport::failed(
                batch.len(),
                pending.len(),
                format!("could not commit sync outcome; outbox unchanged: {error}"),
            );
        }
    }

    // Resolved records have been deleted from the outbox, so clearing markers
    // must cover only the ids that are still there; mark_sending errors on
    // the first missing id and aborts the whole marker transaction.
    let resolved_ids: HashSet<&str> = prefix
        .outcomes
        .iter()
        .map(|outcome| outcome.review_id.as_str())
        .collect();
    let remaining: Vec<String> = batch_ids
        .iter()
        .filter(|id| !resolved_ids.contains(id.as_str()))
        .cloned()
        .collect();
    if !remaining.is_empty() {
        let _ = repo.mark_sending(&remaining, false).await;
    }

    let left_pending = repo
        .pending_outbox()
        .await
        .map(|records| records.len())
        .unwrap_or(pending.len());

    repo.close();

    SyncReport {
        attempted: batch.len(),
        acked: prefix.accepted,
        duplicates: prefix.duplicates,
        conflicts_parked: prefix.conflicts,
        left_pending,
        status: SyncStatus::Drained,
        server_time_ms: Some(response.server_time),
        log_head: Some(response.log_head),
    }
}

/// Build only the contiguous resolved prefix. In particular, a later accepted
/// result MUST NOT jump over blocked/not_attempted/unknown results: doing so
/// would advance the sequence watermark past an unresolved item.
fn resolved_prefix(batch_ids: &[String], results: &[Value]) -> ResolvedPrefix {
    let mut prefix = ResolvedPrefix {
        outcomes: Vec::new(),
        accepted: 0,
        duplicates: 0,
        conflicts: 0,
    };

    for (review_id, result) in batch_ids.iter().zip(results.iter()) {
        if result.get("reviewId").and_then(Value::as_str) != Some(review_id.as_str()) {
            break;
        }

        let status = result.get("status").and_then(Value::as_str).unwrap_or("");
        let outcome = result.get("outcome").and_then(Value::as_str);

        match (status, outcome) {
            ("accepted", _) => {
                prefix.accepted += 1;
                prefix.outcomes.push(SyncOutcome {
                    review_id: review_id.clone(),
                    kind: SyncOutcomeKind::Ack,
                });
            }
            ("duplicate", Some("accepted")) => {
                prefix.duplicates += 1;
                prefix.outcomes.push(SyncOutcome {
                    review_id: review_id.clone(),
                    kind: SyncOutcomeKind::Ack,
                });
            }
            ("stale_card", _) | ("duplicate", Some("stale_card")) => {
                prefix.conflicts += 1;
                prefix
                    .outcomes
                    .push(conflict_outcome(review_id, "stale_card".to_owned(), result));
            }
            ("invalid", _) | ("duplicate", Some("invalid")) => {
                let reason = result
                    .get("reason")
                    .and_then(Value::as_str)
                    .unwrap_or("invalid")
                    .to_owned();
                prefix.conflicts += 1;
                prefix
                    .outcomes
                    .push(conflict_outcome(review_id, reason, result));
            }
            ("idempotency_mismatch", _) => {
                prefix.conflicts += 1;
                prefix.outcomes.push(conflict_outcome(
                    review_id,
                    "idempotency_mismatch".to_owned(),
                    result,
                ));
            }
            // blocked, not_attempted, duplicate of another unresolved outcome,
            // malformed results, and unknown future statuses all end the prefix.
            _ => break,
        }
    }

    prefix
}

fn conflict_outcome(review_id: &str, reason: String, result: &Value) -> SyncOutcome {
    SyncOutcome {
        review_id: review_id.to_owned(),
        kind: SyncOutcomeKind::Conflict {
            reason,
            server_response: Some(result.clone()),
        },
    }
}

/// `retry_index` is zero for the delay before the second HTTP attempt.
/// `random_unit` is injected to keep boundary testing deterministic.
fn backoff_delay_ms(retry_index: u32, random_unit: f64) -> u32 {
    let shift = retry_index.min(15);
    let unjittered = BACKOFF_BASE_MS
        .saturating_mul(1_u32 << shift)
        .min(BACKOFF_CAP_MS);
    let unit = random_unit.clamp(0.0, 1.0);
    let multiplier = 0.75 + unit * 0.5;
    ((unjittered as f64 * multiplier).round() as u32).min(BACKOFF_CAP_MS)
}

pub async fn refresh_conflicts(conflicts: RwSignal<Vec<ConflictRecord>>) {
    match ClientRepository::open().await {
        Ok((repo, _)) => {
            if let Ok(records) = repo.list_conflicts().await {
                conflicts.set(records);
            }
            repo.close();
        }
        Err(_) => {
            // The existing study load/error path reports repository failures.
            // A conflict-refresh failure must not replace the current study view.
        }
    }
}

fn browser_is_online() -> bool {
    web_sys::window()
        .map(|window| window.navigator().on_line())
        .unwrap_or(false)
}

fn server_snapshot(conflict: &ConflictRecord) -> Option<(Option<String>, Option<u32>)> {
    let card = conflict.server_response.as_ref()?.get("card")?;
    let state = card
        .get("state")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let reps = card
        .get("reps")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok());
    Some((state, reps))
}

fn conflict_reason(conflict: &ConflictRecord) -> String {
    if conflict.reason == "stale_card" {
        "Someone else reviewed this card first".to_owned()
    } else {
        conflict.reason.clone()
    }
}

async fn load_conflict_front(conflict: &ConflictRecord) -> Option<String> {
    let (repo, _) = ClientRepository::open().await.ok()?;
    let pack = repo.get_pack(&conflict.pack_id).await.ok().flatten();
    repo.close();

    let pack_card = pack?
        .cards
        .into_iter()
        .find(|card| card.card_id == conflict.card_id)?;

    crate::offline_pack::study_card_from_payload(&pack_card.payload)
        .ok()
        .map(|card| card.front)
}

async fn append_conflict(conflict: ConflictRecord) -> Result<(), String> {
    let snapshot_reps = server_snapshot(&conflict).and_then(|(_, reps)| reps);
    let local = conflict.local_review.clone();
    // A stale-card response always carries the snapshot reps. For conflicts
    // without one (invalid, idempotency mismatch) fall back to the original
    // reps: this is an explicit user action and may produce another durable
    // conflict on the next drain, never a silent drop.
    let expected_reps = snapshot_reps.unwrap_or(local.expected_reps);

    let (repo, _) = ClientRepository::open()
        .await
        .map_err(|error| format!("Could not open repository: {error}"))?;

    let result = repo.queue_append_anyway(&local, expected_reps).await;

    let result = match result {
        Ok(_) => {
            if repo
                .remove_conflict(&conflict.conflict_id)
                .await
                .map_err(|error| format!("Could not remove conflict: {error}"))?
            {
                Ok(())
            } else {
                Err("The conflict was already removed".to_owned())
            }
        }
        Err(error) => Err(format!("Could not queue review: {error}")),
    };

    repo.close();
    result
}

async fn discard_conflict(conflict_id: &str) -> Result<(), String> {
    let (repo, _) = ClientRepository::open()
        .await
        .map_err(|error| format!("Could not open repository: {error}"))?;

    let result = repo
        .remove_conflict(conflict_id)
        .await
        .map_err(|error| format!("Could not remove conflict: {error}"))
        .and_then(|removed| {
            if removed {
                Ok(())
            } else {
                Err("The conflict was already removed".to_owned())
            }
        });

    repo.close();
    result
}

async fn finish_resolution(conflicts: RwSignal<Vec<ConflictRecord>>, on_resolved: Callback<()>) {
    refresh_conflicts(conflicts).await;

    if browser_is_online() {
        // Append sends the new operation immediately. Discard also drains so
        // previously blocked later operations for the card become sendable.
        drain_outbox().await;
        refresh_conflicts(conflicts).await;
        on_resolved.run(());
    }
}

#[component]
pub fn ConflictSection(
    conflicts: RwSignal<Vec<ConflictRecord>>,
    on_resolved: Callback<()>,
) -> impl IntoView {
    view! {
        <Show when=move || !conflicts.get().is_empty()>
            <section class="sync-conflicts" data-testid="sync-conflicts">
                <h2>"Sync conflicts"</h2>
                <For
                    each=move || conflicts.get()
                    key=|conflict| conflict.conflict_id.clone()
                    children=move |conflict| {
                        let submitting = RwSignal::new(false);
                        let discard_armed = RwSignal::new(false);
                        let error = RwSignal::new(Option::<String>::None);
                        let front = RwSignal::new(conflict.card_id.clone());

                        let front_conflict = conflict.clone();
                        spawn_local(async move {
                            if let Some(html) = load_conflict_front(&front_conflict).await {
                                front.set(html);
                            }
                        });

                        let reason = conflict_reason(&conflict);
                        let rating = conflict.local_review.rating;
                        let snapshot = server_snapshot(&conflict);
                        let snapshot_state = snapshot
                            .as_ref()
                            .and_then(|(state, _)| state.clone())
                            .unwrap_or_else(|| "unknown".to_owned());
                        let snapshot_reps = snapshot
                            .as_ref()
                            .and_then(|(_, reps)| *reps)
                            .map(|reps| reps.to_string())
                            .unwrap_or_else(|| "unknown".to_owned());

                        let append_conflict_record = conflict.clone();
                        let append_on_resolved = on_resolved;
                        let discard_conflict_id = conflict.conflict_id.clone();
                        let discard_on_resolved = on_resolved;

                        view! {
                            <article class="sync-conflict" data-testid="sync-conflict">
                                <div
                                    class="sync-conflict-front"
                                    inner_html=move || sanitize::card_html(&front.get())
                                ></div>
                                <p>"Your rating: " <strong>{rating}</strong></p>
                                <p class="sync-conflict-reason">{reason}</p>
                                <p class="sync-conflict-snapshot">
                                    "Server snapshot: state "
                                    <strong>{snapshot_state}</strong>
                                    "; current reps "
                                    <strong>{snapshot_reps}</strong>
                                </p>

                                <button
                                    type="button"
                                    on:click=move |_| {
                                        if submitting.get_untracked() {
                                            return;
                                        }
                                        submitting.set(true);
                                        error.set(None);

                                        let conflict = append_conflict_record.clone();
                                        spawn_local(async move {
                                            match append_conflict(conflict).await {
                                                Ok(()) => {
                                                    finish_resolution(
                                                        conflicts,
                                                        append_on_resolved,
                                                    ).await;
                                                }
                                                Err(message) => error.set(Some(message)),
                                            }
                                            submitting.set(false);
                                        });
                                    }
                                >
                                    "Append anyway"
                                </button>

                                <button
                                    type="button"
                                    on:click=move |_| {
                                        if submitting.get_untracked() {
                                            return;
                                        }

                                        if !discard_armed.get_untracked() {
                                            discard_armed.set(true);
                                            return;
                                        }

                                        submitting.set(true);
                                        error.set(None);
                                        let conflict_id = discard_conflict_id.clone();

                                        spawn_local(async move {
                                            match discard_conflict(&conflict_id).await {
                                                Ok(()) => {
                                                    finish_resolution(
                                                        conflicts,
                                                        discard_on_resolved,
                                                    ).await;
                                                }
                                                Err(message) => {
                                                    discard_armed.set(false);
                                                    error.set(Some(message));
                                                }
                                            }
                                            submitting.set(false);
                                        });
                                    }
                                >
                                    {move || if discard_armed.get() {
                                        "Discard? Yes, discard"
                                    } else {
                                        "Discard"
                                    }}
                                </button>

                                <Show when=move || error.get().is_some()>
                                    <p role="alert">{move || error.get().unwrap_or_default()}</p>
                                </Show>
                            </article>
                        }
                    }
                />
            </section>
        </Show>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result(review_id: &str, status: &str) -> Value {
        json!({"reviewId": review_id, "status": status})
    }

    #[test]
    fn resolved_prefix_stops_at_blocked() {
        let ids = vec!["a".to_owned(), "b".to_owned(), "c".to_owned()];
        let results = vec![
            result("a", "accepted"),
            result("b", "blocked"),
            result("c", "accepted"),
        ];

        let prefix = resolved_prefix(&ids, &results);
        assert_eq!(prefix.outcomes.len(), 1);
        assert_eq!(prefix.accepted, 1);
    }

    #[test]
    fn resolved_prefix_stops_at_not_attempted_and_unknown_id() {
        let ids = vec!["a".to_owned(), "b".to_owned(), "c".to_owned()];

        let prefix = resolved_prefix(
            &ids,
            &[result("a", "not_attempted"), result("b", "accepted")],
        );
        assert!(prefix.outcomes.is_empty());

        let prefix = resolved_prefix(&ids, &[result("different", "accepted")]);
        assert!(prefix.outcomes.is_empty());
    }

    #[test]
    fn duplicate_accepted_acks_but_duplicate_stale_conflicts() {
        let ids = vec!["a".to_owned(), "b".to_owned(), "c".to_owned()];
        let results = vec![
            json!({
                "reviewId": "a",
                "status": "duplicate",
                "outcome": "accepted"
            }),
            json!({
                "reviewId": "b",
                "status": "duplicate",
                "outcome": "stale_card",
                "card": {"reps": 4, "state": "review"}
            }),
            result("c", "accepted"),
        ];

        let prefix = resolved_prefix(&ids, &results);
        assert_eq!(prefix.outcomes.len(), 3);
        assert_eq!(prefix.duplicates, 1);
        assert_eq!(prefix.conflicts, 1);
        assert_eq!(prefix.accepted, 1);
        assert!(matches!(
            prefix.outcomes[1].kind,
            SyncOutcomeKind::Conflict { ref reason, .. } if reason == "stale_card"
        ));
    }

    #[test]
    fn duplicate_invalid_uses_original_reason() {
        let ids = vec!["a".to_owned()];
        let prefix = resolved_prefix(
            &ids,
            &[json!({
                "reviewId": "a",
                "status": "duplicate",
                "outcome": "invalid",
                "reason": "card_not_found"
            })],
        );

        assert_eq!(prefix.conflicts, 1);
        assert!(matches!(
            prefix.outcomes[0].kind,
            SyncOutcomeKind::Conflict { ref reason, .. }
                if reason == "card_not_found"
        ));
    }

    #[test]
    fn backoff_has_deterministic_bounds_and_cap() {
        assert_eq!(backoff_delay_ms(0, 0.5), 1_000);
        assert_eq!(backoff_delay_ms(1, 0.5), 2_000);
        assert_eq!(backoff_delay_ms(0, 0.0), 750);
        assert_eq!(backoff_delay_ms(0, 1.0), 1_250);
        assert_eq!(backoff_delay_ms(20, 0.5), 30_000);
        assert_eq!(backoff_delay_ms(20, 1.0), 30_000);
    }
}
