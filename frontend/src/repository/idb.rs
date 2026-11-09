use std::collections::{BTreeMap, BTreeSet};

use js_sys::{Array, Promise};
use serde::Serialize;
use serde_json::Value;
use wasm_bindgen::{closure::Closure, JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;
use web_sys::{
    DomException, IdbDatabase, IdbFactory, IdbIndexParameters, IdbObjectStore,
    IdbObjectStoreParameters, IdbOpenDbRequest, IdbRequest, IdbTransaction, IdbTransactionMode,
    IdbVersionChangeEvent,
};

use super::model::*;
use super::{
    convert, hash, sequence, validate, DB_NAME, DB_VERSION, DIAGNOSTIC_FORMAT_VERSION,
    MAX_SAFE_INTEGER, OUTBOX_PAYLOAD_SCHEMA_VERSION, PACK_SCHEMA_VERSION,
    REPOSITORY_SCHEMA_VERSION,
};

const META_STORE: &str = "meta";
const PACKS_STORE: &str = "packs";
const PACK_CARDS_STORE: &str = "pack_cards";
const OUTBOX_STORE: &str = "outbox";
const CONFLICTS_STORE: &str = "conflicts";
const QUARANTINE_STORE: &str = "quarantine";
const META_KEY: &str = "repository";
const BLOCKED_REJECTION: &str = "srep-indexeddb-blocked";

const ALL_RECOVERY_STORES: [&str; 6] = [
    OUTBOX_STORE,
    PACKS_STORE,
    PACK_CARDS_STORE,
    CONFLICTS_STORE,
    QUARANTINE_STORE,
    META_STORE,
];

#[derive(Clone)]
pub struct ClientRepository {
    db: IdbDatabase,
    device_id: String,
    recovery: RecoveryReport,
}

#[derive(Clone)]
struct RawRecord {
    key: JsValue,
    value: Value,
}

struct Snapshots {
    packs: Vec<RawRecord>,
    pack_cards: Vec<RawRecord>,
    outbox: Vec<RawRecord>,
    conflicts: Vec<RawRecord>,
    #[allow(dead_code)]
    quarantine: Vec<Value>,
}

struct PlannedQuarantine {
    source_store: &'static str,
    source_key: JsValue,
    record: QuarantineRecord,
}

struct PackEntry {
    raw: RawRecord,
    pack: Option<PackRecord>,
    cards: Vec<(RawRecord, PackCardRecord)>,
    discard: bool,
}

struct RecoveryPlan {
    quarantines: Vec<PlannedQuarantine>,
    pack_deletes: Vec<JsValue>,
    card_deletes: Vec<JsValue>,
    sending_updates: Vec<OutboxRecord>,
    report: RecoveryReport,
}

impl ClientRepository {
    pub async fn open() -> Result<(Self, OpenReport), RepositoryError> {
        let factory = indexed_db_factory()?;
        let request = factory
            .open_with_u32(DB_NAME, DB_VERSION)
            .map_err(|error| RepositoryError::Open(js_value_message(&error)))?;
        let db = await_open_request(request).await?;

        let existing_meta = read_meta_value(&db).await?;
        let meta = match existing_meta {
            Some(value) => parse_meta(&value)?,
            None => {
                if !repository_stores_empty(&db).await? {
                    return Err(RepositoryError::MetaCorrupt(
                        "The repository meta record is missing but other stores contain data"
                            .to_string(),
                    ));
                }

                let meta = MetaRecord {
                    key: META_KEY.to_string(),
                    schema_version: REPOSITORY_SCHEMA_VERSION,
                    device_id: new_uuid()?,
                    next_seq: 1,
                    acked_through_seq: 0,
                };
                write_initial_meta(&db, &meta).await?;
                meta
            }
        };

        let persistence = Self::request_persistent_storage().await;
        let snapshots = snapshot_stores(&db).await?;
        let plan = build_recovery_plan(&meta, snapshots)?;
        let recovery = apply_recovery_plan(&db, plan).await?;

        let device_id = meta.device_id.clone();
        let repository = Self {
            db,
            device_id: device_id.clone(),
            recovery: recovery.clone(),
        };
        let report = OpenReport {
            device_id,
            persistence,
            recovery,
        };

        Ok((repository, report))
    }

    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    pub fn recovery_report(&self) -> &RecoveryReport {
        &self.recovery
    }

    pub fn close(&self) {
        self.db.close();
    }

    pub async fn request_persistent_storage() -> PersistenceStatus {
        let Some(window) = web_sys::window() else {
            return PersistenceStatus::Unavailable;
        };
        let storage = window.navigator().storage();
        match storage.persist() {
            Ok(promise) => match JsFuture::from(promise).await {
                Ok(value) if value.as_bool() == Some(true) => PersistenceStatus::Granted,
                Ok(_) | Err(_) => PersistenceStatus::NotGranted,
            },
            Err(_) => PersistenceStatus::Unavailable,
        }
    }

    pub async fn delete_database() -> Result<(), RepositoryError> {
        let factory = indexed_db_factory()?;
        let request = factory
            .delete_database(DB_NAME)
            .map_err(|error| RepositoryError::Open(js_value_message(&error)))?;

        let promise = Promise::new(&mut |resolve, reject| {
            let resolve_for_success = resolve.clone();
            let success = Closure::once_into_js(move || {
                let _ = resolve_for_success.call0(&JsValue::UNDEFINED);
            });
            request.set_onsuccess(Some(success.unchecked_ref()));

            let request_for_error = request.clone();
            let reject_for_error = reject.clone();
            let error = Closure::once_into_js(move || {
                let value = open_request_error(&request_for_error);
                let _ = reject_for_error.call1(&JsValue::UNDEFINED, &value);
            });
            request.set_onerror(Some(error.unchecked_ref()));

            let blocked = Closure::once_into_js(move || {
                let _ = reject.call1(&JsValue::UNDEFINED, &JsValue::from_str(BLOCKED_REJECTION));
            });
            request.set_onblocked(Some(blocked.unchecked_ref()));
        });

        match JsFuture::from(promise).await {
            Ok(_) => Ok(()),
            Err(error) if error.as_string().as_deref() == Some(BLOCKED_REJECTION) => {
                Err(RepositoryError::Blocked)
            }
            Err(error) => Err(RepositoryError::Open(js_value_message(&error))),
        }
    }

    pub async fn store_pack(&self, pack: PackData) -> Result<(), RepositoryError> {
        const OPERATION: &str = "store_pack";

        if !validate::is_valid_id(&pack.pack_id) {
            return Err(RepositoryError::InvalidInput(
                "pack_id is not a valid identifier".to_string(),
            ));
        }
        if pack.server_revision.trim().is_empty() {
            return Err(RepositoryError::InvalidInput(
                "server_revision must not be empty".to_string(),
            ));
        }

        let mut ordinals = BTreeSet::new();
        for card in &pack.cards {
            if !validate::is_valid_id(&card.card_id) {
                return Err(RepositoryError::InvalidInput(format!(
                    "Invalid card_id: {}",
                    card.card_id
                )));
            }
            if !ordinals.insert(card.ordinal) {
                return Err(RepositoryError::InvalidInput(format!(
                    "Duplicate card ordinal {}",
                    card.ordinal
                )));
            }
        }
        for (expected, ordinal) in ordinals.iter().enumerate() {
            if *ordinal != expected as u32 {
                return Err(RepositoryError::InvalidInput(
                    "Card ordinals must be contiguous from zero".to_string(),
                ));
            }
        }

        let pack_record = PackRecord {
            pack_id: pack.pack_id.clone(),
            schema_version: PACK_SCHEMA_VERSION,
            server_revision: pack.server_revision.clone(),
            server_time_ms: pack.server_time_ms,
            server_time_offset_ms: pack.server_time_offset_ms,
            payload: pack.payload.clone(),
            payload_hash: hash::pack_hash(
                &pack.pack_id,
                PACK_SCHEMA_VERSION,
                &pack.server_revision,
                pack.server_time_ms,
                pack.server_time_offset_ms,
                &pack.payload,
            ),
        };

        let mut card_records = Vec::with_capacity(pack.cards.len());
        for card in &pack.cards {
            card_records.push(PackCardRecord {
                pack_id: pack.pack_id.clone(),
                card_id: card.card_id.clone(),
                schema_version: PACK_SCHEMA_VERSION,
                ordinal: card.ordinal,
                reps: card.reps,
                answered: false,
                payload: card.payload.clone(),
                payload_hash: hash::pack_card_hash(
                    &pack.pack_id,
                    &card.card_id,
                    PACK_SCHEMA_VERSION,
                    card.ordinal,
                    card.reps,
                    &card.payload,
                ),
            });
        }

        let pack_value = serde_json::to_value(&pack_record)
            .map_err(|error| serialization_error(PACKS_STORE, OPERATION, error))?;
        validate::validate_pack_record(&pack_value).map_err(validation_invalid_input)?;
        for card in &card_records {
            let value = serde_json::to_value(card)
                .map_err(|error| serialization_error(PACK_CARDS_STORE, OPERATION, error))?;
            validate::validate_pack_card_record(&value).map_err(validation_invalid_input)?;
        }

        let pack_js = record_to_js(&pack_record, PACKS_STORE, OPERATION)?;
        let mut cards_js = Vec::with_capacity(card_records.len());
        for card in &card_records {
            cards_js.push(record_to_js(card, PACK_CARDS_STORE, OPERATION)?);
        }

        let (tx, completion) = start_transaction(
            &self.db,
            &[PACKS_STORE, PACK_CARDS_STORE],
            IdbTransactionMode::Readwrite,
            OPERATION,
        )?;

        let result: Result<(), RepositoryError> = async {
            let packs = object_store(&tx, PACKS_STORE, OPERATION)?;
            let cards = object_store(&tx, PACK_CARDS_STORE, OPERATION)?;
            let index = cards
                .index("byPackId")
                .map_err(|error| transaction_error(OPERATION, error))?;
            let keys_request = index
                .get_all_keys_with_key(&JsValue::from_str(&pack.pack_id))
                .map_err(|error| transaction_error(OPERATION, error))?;
            let keys = request_value(keys_request, OPERATION).await?;
            for key in Array::from(&keys).iter() {
                let request = cards
                    .delete(&key)
                    .map_err(|error| transaction_error(OPERATION, error))?;
                request_value(request, OPERATION).await?;
            }

            let delete_pack = packs
                .delete(&JsValue::from_str(&pack.pack_id))
                .map_err(|error| transaction_error(OPERATION, error))?;
            request_value(delete_pack, OPERATION).await?;

            let put_pack = packs
                .put(&pack_js)
                .map_err(|error| transaction_error(OPERATION, error))?;
            request_value(put_pack, OPERATION).await?;

            for card in &cards_js {
                let request = cards
                    .put(card)
                    .map_err(|error| transaction_error(OPERATION, error))?;
                request_value(request, OPERATION).await?;
            }
            Ok(())
        }
        .await;

        finish_transaction_result(tx, completion, OPERATION, result).await
    }

    pub async fn list_packs(&self) -> Result<Vec<PackRecord>, RepositoryError> {
        const OPERATION: &str = "list_packs";

        let (tx, _completion) = start_transaction(
            &self.db,
            &[PACKS_STORE],
            IdbTransactionMode::Readonly,
            OPERATION,
        )?;
        let store = tx
            .object_store(PACKS_STORE)
            .map_err(|error| RepositoryError::Open(format!("{OPERATION}: {error:?}")))?;
        let request = store
            .get_all()
            .map_err(|error| RepositoryError::Open(format!("{OPERATION}: {error:?}")))?;

        let promise = Promise::new(&mut |resolve, reject| {
            let success_request = request.clone();
            let on_success = Closure::once(move || {
                let value = success_request.result().unwrap_or(JsValue::UNDEFINED);
                let _ = resolve.call1(&JsValue::UNDEFINED, &value);
            });
            let on_error = Closure::once(move || {
                let _ = reject.call1(
                    &JsValue::UNDEFINED,
                    &JsValue::from_str("list_packs request failed"),
                );
            });
            request.set_onsuccess(Some(on_success.as_ref().unchecked_ref()));
            request.set_onerror(Some(on_error.as_ref().unchecked_ref()));
            on_success.forget();
            on_error.forget();
        });
        let value = JsFuture::from(promise).await.map_err(|error| {
            RepositoryError::Open(format!("{OPERATION}: {}", js_value_message(&error)))
        })?;
        let values = value
            .dyn_into::<Array>()
            .map_err(|error| RepositoryError::Open(format!("{OPERATION}: {error:?}")))?;

        let mut packs = Vec::with_capacity(values.length() as usize);
        for value in values.iter() {
            let text = js_sys::JSON::stringify(&value)
                .map_err(|error| RepositoryError::Open(format!("{OPERATION}: {error:?}")))?
                .as_string()
                .ok_or_else(|| {
                    RepositoryError::Open(format!("{OPERATION}: record was not JSON"))
                })?;
            let pack = serde_json::from_str::<PackRecord>(&text)
                .map_err(|error| RepositoryError::Open(format!("{OPERATION}: {error}")))?;
            packs.push(pack);
        }
        packs.sort_by(|left, right| right.server_time_ms.cmp(&left.server_time_ms));
        Ok(packs)
    }

    pub async fn get_pack(&self, pack_id: &str) -> Result<Option<StoredPack>, RepositoryError> {
        const OPERATION: &str = "get_pack";

        let (tx, completion) = start_transaction(
            &self.db,
            &[PACKS_STORE, PACK_CARDS_STORE],
            IdbTransactionMode::Readonly,
            OPERATION,
        )?;

        let result: Result<Option<StoredPack>, RepositoryError> = async {
            let packs = object_store(&tx, PACKS_STORE, OPERATION)?;
            let request = packs
                .get(&JsValue::from_str(pack_id))
                .map_err(|error| transaction_error(OPERATION, error))?;
            let raw_pack = request_value(request, OPERATION).await?;
            if raw_pack.is_undefined() || raw_pack.is_null() {
                return Ok(None);
            }

            let pack_value = match convert::js_to_value(&raw_pack) {
                Ok(value) => value,
                Err(_) => return Ok(None),
            };
            let pack = match validate::validate_pack_record(&pack_value) {
                Ok(pack) => pack,
                Err(_) => return Ok(None),
            };

            let cards_store = object_store(&tx, PACK_CARDS_STORE, OPERATION)?;
            let index = cards_store
                .index("byPackId")
                .map_err(|error| transaction_error(OPERATION, error))?;
            let request = index
                .get_all_with_key(&JsValue::from_str(pack_id))
                .map_err(|error| transaction_error(OPERATION, error))?;
            let raw_cards = request_value(request, OPERATION).await?;

            let mut cards = Vec::new();
            for raw in Array::from(&raw_cards).iter() {
                let value = match convert::js_to_value(&raw) {
                    Ok(value) => value,
                    Err(_) => return Ok(None),
                };
                match validate::validate_pack_card_record(&value) {
                    Ok(card) if card.pack_id == pack.pack_id => cards.push(card),
                    _ => return Ok(None),
                }
            }
            cards.sort_by(|left, right| {
                left.ordinal
                    .cmp(&right.ordinal)
                    .then_with(|| left.card_id.cmp(&right.card_id))
            });

            Ok(Some(StoredPack { pack, cards }))
        }
        .await;

        finish_transaction_result(tx, completion, OPERATION, result).await
    }

    pub async fn queue_review(&self, review: NewReview) -> Result<OutboxRecord, RepositoryError> {
        const OPERATION: &str = "queue_review";

        validate::validate_new_review(&review)?;
        if !self.recovery.usable {
            return Err(RepositoryError::RecoveryRequired);
        }

        let (tx, completion) = start_transaction(
            &self.db,
            &[META_STORE, PACKS_STORE, PACK_CARDS_STORE, OUTBOX_STORE],
            IdbTransactionMode::Readwrite,
            OPERATION,
        )?;

        let device_id = self.device_id.clone();
        let result: Result<OutboxRecord, RepositoryError> = async {
            let meta_store = object_store(&tx, META_STORE, OPERATION)?;
            let packs = object_store(&tx, PACKS_STORE, OPERATION)?;
            let cards = object_store(&tx, PACK_CARDS_STORE, OPERATION)?;
            let outbox = object_store(&tx, OUTBOX_STORE, OPERATION)?;

            let request = meta_store
                .get(&JsValue::from_str(META_KEY))
                .map_err(|error| transaction_error(OPERATION, error))?;
            let raw_meta = request_value(request, OPERATION).await?;
            if raw_meta.is_undefined() {
                return Err(RepositoryError::MetaCorrupt(
                    "The repository meta record is missing".to_string(),
                ));
            }
            let meta_value = convert::js_to_value(&raw_meta)
                .map_err(|error| RepositoryError::MetaCorrupt(error.to_string()))?;
            let meta = parse_meta(&meta_value)?;

            let request = packs
                .get(&JsValue::from_str(&review.pack_id))
                .map_err(|error| transaction_error(OPERATION, error))?;
            let raw_pack = request_value(request, OPERATION).await?;
            if raw_pack.is_undefined() {
                return Err(RepositoryError::PackNotFound(review.pack_id.clone()));
            }
            let pack_value = convert::js_to_value(&raw_pack).map_err(|error| {
                RepositoryError::Serialization(format!(
                    "Invalid pack {} during queue_review: {}",
                    review.pack_id, error
                ))
            })?;
            let pack = validate::validate_pack_record(&pack_value).map_err(|failure| {
                RepositoryError::Serialization(format!(
                    "Invalid pack {} during queue_review: {}",
                    review.pack_id,
                    validation_message(&failure)
                ))
            })?;

            let card_key = compound_pack_card_key(&review.pack_id, &review.card_id);
            let request = cards
                .get(&card_key)
                .map_err(|error| transaction_error(OPERATION, error))?;
            let raw_card = request_value(request, OPERATION).await?;
            if raw_card.is_undefined() {
                return Err(RepositoryError::CardNotFound {
                    pack_id: review.pack_id.clone(),
                    card_id: review.card_id.clone(),
                });
            }
            let card_value = convert::js_to_value(&raw_card).map_err(|error| {
                RepositoryError::Serialization(format!(
                    "Invalid card {}/{} during queue_review: {}",
                    review.pack_id, review.card_id, error
                ))
            })?;
            let card = validate::validate_pack_card_record(&card_value).map_err(|failure| {
                RepositoryError::Serialization(format!(
                    "Invalid card {}/{} during queue_review: {}",
                    review.pack_id,
                    review.card_id,
                    validation_message(&failure)
                ))
            })?;

            if card.answered {
                return Err(RepositoryError::CardAlreadyAnswered {
                    pack_id: review.pack_id.clone(),
                    card_id: review.card_id.clone(),
                });
            }
            if card.reps != review.expected_reps {
                return Err(RepositoryError::RepsMismatch {
                    expected: review.expected_reps,
                    actual: card.reps,
                });
            }

            let seq = meta.next_seq;
            if seq > MAX_SAFE_INTEGER || seq.saturating_add(1) > MAX_SAFE_INTEGER {
                return Err(RepositoryError::SequenceExhausted);
            }

            let payload = ReviewPayload {
                review_id: new_uuid()?,
                device_id,
                seq,
                pack_id: review.pack_id,
                card_id: review.card_id,
                rating: review.rating,
                expected_reps: review.expected_reps,
                elapsed_ms: review.elapsed_ms,
                client_occurred_at_ms: review.client_occurred_at_ms,
                pack_server_time_ms: pack.server_time_ms,
                pack_server_time_offset_ms: pack.server_time_offset_ms,
                payload_schema_version: OUTBOX_PAYLOAD_SCHEMA_VERSION,
            };
            let payload_hash = hash::review_payload_hash(&payload);
            let record = payload.into_outbox(false, payload_hash);
            let record_js = record_to_js(&record, OUTBOX_STORE, OPERATION)?;

            let updated_meta = MetaRecord {
                next_seq: seq + 1,
                ..meta
            };
            let updated_card = PackCardRecord {
                answered: true,
                ..card
            };
            let meta_js = record_to_js(&updated_meta, META_STORE, OPERATION)?;
            let card_js = record_to_js(&updated_card, PACK_CARDS_STORE, OPERATION)?;

            let request = outbox
                .add(&record_js)
                .map_err(|error| transaction_error(OPERATION, error))?;
            request_value(request, OPERATION).await?;
            let request = meta_store
                .put(&meta_js)
                .map_err(|error| transaction_error(OPERATION, error))?;
            request_value(request, OPERATION).await?;
            let request = cards
                .put(&card_js)
                .map_err(|error| transaction_error(OPERATION, error))?;
            request_value(request, OPERATION).await?;

            Ok(record)
        }
        .await;

        finish_transaction_result(tx, completion, OPERATION, result).await
    }

    pub async fn cancel_latest_unsent(
        &self,
        pack_id: &str,
    ) -> Result<Option<OutboxRecord>, RepositoryError> {
        const OPERATION: &str = "cancel_latest_unsent";

        if !self.recovery.usable {
            return Err(RepositoryError::RecoveryRequired);
        }

        let (tx, completion) = start_transaction(
            &self.db,
            &[META_STORE, PACK_CARDS_STORE, OUTBOX_STORE],
            IdbTransactionMode::Readwrite,
            OPERATION,
        )?;

        let result: Result<Option<OutboxRecord>, RepositoryError> = async {
            let meta_store = object_store(&tx, META_STORE, OPERATION)?;
            let cards = object_store(&tx, PACK_CARDS_STORE, OPERATION)?;
            let outbox = object_store(&tx, OUTBOX_STORE, OPERATION)?;

            let request = meta_store
                .get(&JsValue::from_str(META_KEY))
                .map_err(|error| transaction_error(OPERATION, error))?;
            let raw_meta = request_value(request, OPERATION).await?;
            if raw_meta.is_undefined() {
                return Err(RepositoryError::MetaCorrupt(
                    "The repository meta record is missing".to_string(),
                ));
            }
            let meta_value = convert::js_to_value(&raw_meta)
                .map_err(|error| RepositoryError::MetaCorrupt(error.to_string()))?;
            let meta = parse_meta(&meta_value)?;

            let raw_records = scan_values(&outbox, OPERATION).await?;
            let records = validate_outbox_values(raw_records, &self.device_id, OPERATION)?;
            let Some(record) = records
                .into_iter()
                .filter(|record| record.pack_id.as_str() == pack_id)
                .max_by_key(|record| record.seq)
            else {
                return Ok(None);
            };

            if meta.next_seq.checked_sub(1) != Some(record.seq) {
                return Err(RepositoryError::InvalidInput(format!(
                    "The latest review for pack {pack_id} is not the globally latest review"
                )));
            }

            let card_key = compound_pack_card_key(pack_id, &record.card_id);
            let request = cards
                .get(&card_key)
                .map_err(|error| transaction_error(OPERATION, error))?;
            let raw_card = request_value(request, OPERATION).await?;
            if raw_card.is_undefined() {
                return Err(RepositoryError::CardNotFound {
                    pack_id: pack_id.to_string(),
                    card_id: record.card_id.clone(),
                });
            }
            let card_value = convert::js_to_value(&raw_card).map_err(|error| {
                RepositoryError::Serialization(format!(
                    "Invalid card {}/{} during cancel_latest_unsent: {}",
                    pack_id, record.card_id, error
                ))
            })?;
            let card = validate::validate_pack_card_record(&card_value).map_err(|failure| {
                RepositoryError::Serialization(format!(
                    "Invalid card {}/{} during cancel_latest_unsent: {}",
                    pack_id,
                    record.card_id,
                    validation_message(&failure)
                ))
            })?;

            let updated_meta = MetaRecord {
                next_seq: record.seq,
                ..meta
            };
            let updated_card = PackCardRecord {
                answered: false,
                ..card
            };
            let meta_js = record_to_js(&updated_meta, META_STORE, OPERATION)?;
            let card_js = record_to_js(&updated_card, PACK_CARDS_STORE, OPERATION)?;

            let request = outbox
                .delete(&JsValue::from_str(&record.review_id))
                .map_err(|error| transaction_error(OPERATION, error))?;
            request_value(request, OPERATION).await?;
            let request = meta_store
                .put(&meta_js)
                .map_err(|error| transaction_error(OPERATION, error))?;
            request_value(request, OPERATION).await?;
            let request = cards
                .put(&card_js)
                .map_err(|error| transaction_error(OPERATION, error))?;
            request_value(request, OPERATION).await?;

            Ok(Some(record))
        }
        .await;

        finish_transaction_result(tx, completion, OPERATION, result).await
    }

    pub async fn pending_outbox(&self) -> Result<Vec<OutboxRecord>, RepositoryError> {
        const OPERATION: &str = "pending_outbox";

        let (tx, completion) = start_transaction(
            &self.db,
            &[META_STORE, OUTBOX_STORE],
            IdbTransactionMode::Readonly,
            OPERATION,
        )?;

        let result: Result<Vec<OutboxRecord>, RepositoryError> = async {
            let meta_store = object_store(&tx, META_STORE, OPERATION)?;
            let outbox = object_store(&tx, OUTBOX_STORE, OPERATION)?;

            let request = meta_store
                .get(&JsValue::from_str(META_KEY))
                .map_err(|error| transaction_error(OPERATION, error))?;
            let raw_meta = request_value(request, OPERATION).await?;
            if raw_meta.is_undefined() {
                return Err(RepositoryError::MetaCorrupt(
                    "The repository meta record is missing".to_string(),
                ));
            }
            let meta_value = convert::js_to_value(&raw_meta)
                .map_err(|error| RepositoryError::MetaCorrupt(error.to_string()))?;
            let meta = parse_meta(&meta_value)?;

            let raw_records = scan_values(&outbox, OPERATION).await?;
            let records = validate_outbox_values(raw_records, &self.device_id, OPERATION)?;
            let split = sequence::split_outbox_prefix(
                records,
                &self.device_id,
                meta.acked_through_seq,
                meta.next_seq,
            );
            Ok(split.valid_prefix)
        }
        .await;

        finish_transaction_result(tx, completion, OPERATION, result).await
    }

    pub async fn mark_sending(
        &self,
        review_ids: &[String],
        sending: bool,
    ) -> Result<(), RepositoryError> {
        const OPERATION: &str = "mark_sending";

        let (tx, completion) = start_transaction(
            &self.db,
            &[OUTBOX_STORE],
            IdbTransactionMode::Readwrite,
            OPERATION,
        )?;

        let result: Result<(), RepositoryError> = async {
            let outbox = object_store(&tx, OUTBOX_STORE, OPERATION)?;
            for review_id in review_ids {
                let request = outbox
                    .get(&JsValue::from_str(review_id))
                    .map_err(|error| transaction_error(OPERATION, error))?;
                let raw = request_value(request, OPERATION).await?;
                if raw.is_undefined() {
                    return Err(RepositoryError::InvalidInput(format!(
                        "Outbox review does not exist: {}",
                        review_id
                    )));
                }
                let value = convert::js_to_value(&raw).map_err(|error| {
                    RepositoryError::Serialization(format!(
                        "Invalid outbox record {} during mark_sending: {}",
                        review_id, error
                    ))
                })?;
                let mut record = validate::validate_outbox_record(&value, &self.device_id)
                    .map_err(|failure| {
                        RepositoryError::Serialization(format!(
                            "Invalid outbox record {} during mark_sending: {}",
                            review_id,
                            validation_message(&failure)
                        ))
                    })?;
                record.sending = sending;
                let js = record_to_js(&record, OUTBOX_STORE, OPERATION)?;
                let request = outbox
                    .put(&js)
                    .map_err(|error| transaction_error(OPERATION, error))?;
                request_value(request, OPERATION).await?;
            }
            Ok(())
        }
        .await;

        finish_transaction_result(tx, completion, OPERATION, result).await
    }

    pub async fn remove_acked(&self, review_ids: &[String]) -> Result<u32, RepositoryError> {
        const OPERATION: &str = "remove_acked";

        if review_ids.is_empty() {
            return Ok(0);
        }

        let pending = self.pending_outbox().await?;
        let count = sequence::validate_ack_prefix(review_ids, &pending)?;
        let last_id = review_ids.last().ok_or_else(|| {
            RepositoryError::AckNotContiguous("No reviews were supplied".to_string())
        })?;
        let last_seq = pending
            .iter()
            .find(|record| &record.review_id == last_id)
            .map(|record| record.seq)
            .ok_or_else(|| {
                RepositoryError::AckNotContiguous(format!(
                    "The final acknowledged review is not pending: {}",
                    last_id
                ))
            })?;

        let (tx, completion) = start_transaction(
            &self.db,
            &[OUTBOX_STORE, META_STORE],
            IdbTransactionMode::Readwrite,
            OPERATION,
        )?;

        let result: Result<u32, RepositoryError> = async {
            let outbox = object_store(&tx, OUTBOX_STORE, OPERATION)?;
            let meta_store = object_store(&tx, META_STORE, OPERATION)?;

            let request = meta_store
                .get(&JsValue::from_str(META_KEY))
                .map_err(|error| transaction_error(OPERATION, error))?;
            let raw_meta = request_value(request, OPERATION).await?;
            if raw_meta.is_undefined() {
                return Err(RepositoryError::MetaCorrupt(
                    "The repository meta record is missing".to_string(),
                ));
            }
            let meta_value = convert::js_to_value(&raw_meta)
                .map_err(|error| RepositoryError::MetaCorrupt(error.to_string()))?;
            let meta = parse_meta(&meta_value)?;

            for review_id in review_ids {
                let request = outbox
                    .delete(&JsValue::from_str(review_id))
                    .map_err(|error| transaction_error(OPERATION, error))?;
                request_value(request, OPERATION).await?;
            }

            let updated_meta = MetaRecord {
                acked_through_seq: last_seq,
                ..meta
            };
            let meta_js = record_to_js(&updated_meta, META_STORE, OPERATION)?;
            let request = meta_store
                .put(&meta_js)
                .map_err(|error| transaction_error(OPERATION, error))?;
            request_value(request, OPERATION).await?;
            Ok(count)
        }
        .await;

        finish_transaction_result(tx, completion, OPERATION, result).await
    }

    pub async fn record_conflict(
        &self,
        conflict: NewConflict,
    ) -> Result<ConflictRecord, RepositoryError> {
        const OPERATION: &str = "record_conflict";

        if conflict.reason.trim().is_empty() {
            return Err(RepositoryError::InvalidInput(
                "Conflict reason must not be empty".to_string(),
            ));
        }
        let detected_limit = MAX_SAFE_INTEGER as i64;
        if conflict.detected_at_ms < -detected_limit || conflict.detected_at_ms > detected_limit {
            return Err(RepositoryError::InvalidInput(
                "Conflict detection time is outside the safe integer range".to_string(),
            ));
        }

        let review = conflict.review;
        let record = ConflictRecord {
            conflict_id: new_uuid()?,
            review_id: review.review_id.clone(),
            device_id: review.device_id.clone(),
            seq: review.seq,
            pack_id: review.pack_id.clone(),
            card_id: review.card_id.clone(),
            reason: conflict.reason,
            local_review: review.payload(),
            server_response: conflict.server_response,
            detected_at_ms: conflict.detected_at_ms,
        };
        let record_js = record_to_js(&record, CONFLICTS_STORE, OPERATION)?;

        let (tx, completion) = start_transaction(
            &self.db,
            &[CONFLICTS_STORE],
            IdbTransactionMode::Readwrite,
            OPERATION,
        )?;

        let result: Result<ConflictRecord, RepositoryError> = async {
            let conflicts = object_store(&tx, CONFLICTS_STORE, OPERATION)?;
            let request = conflicts
                .add(&record_js)
                .map_err(|error| transaction_error(OPERATION, error))?;
            request_value(request, OPERATION).await?;
            Ok(record)
        }
        .await;

        finish_transaction_result(tx, completion, OPERATION, result).await
    }

    pub async fn list_conflicts(&self) -> Result<Vec<ConflictRecord>, RepositoryError> {
        const OPERATION: &str = "list_conflicts";

        let (tx, completion) = start_transaction(
            &self.db,
            &[CONFLICTS_STORE],
            IdbTransactionMode::Readonly,
            OPERATION,
        )?;

        let result: Result<Vec<ConflictRecord>, RepositoryError> = async {
            let conflicts_store = object_store(&tx, CONFLICTS_STORE, OPERATION)?;
            let values = scan_values(&conflicts_store, OPERATION).await?;
            let mut conflicts = Vec::with_capacity(values.len());
            for value in values {
                let id = value
                    .get("conflictId")
                    .and_then(Value::as_str)
                    .unwrap_or("<unknown>")
                    .to_string();
                let conflict = validate::validate_conflict_record(&value).map_err(|failure| {
                    RepositoryError::Serialization(format!(
                        "Invalid conflict {} during list_conflicts: {}",
                        id,
                        validation_message(&failure)
                    ))
                })?;
                conflicts.push(conflict);
            }
            conflicts.sort_by(|left, right| {
                left.seq
                    .cmp(&right.seq)
                    .then_with(|| left.conflict_id.cmp(&right.conflict_id))
            });
            Ok(conflicts)
        }
        .await;

        finish_transaction_result(tx, completion, OPERATION, result).await
    }

    pub async fn remove_conflict(&self, conflict_id: &str) -> Result<bool, RepositoryError> {
        const OPERATION: &str = "remove_conflict";

        let (tx, completion) = start_transaction(
            &self.db,
            &[CONFLICTS_STORE],
            IdbTransactionMode::Readwrite,
            OPERATION,
        )?;

        let result: Result<bool, RepositoryError> = async {
            let conflicts = object_store(&tx, CONFLICTS_STORE, OPERATION)?;
            let key = JsValue::from_str(conflict_id);
            let request = conflicts
                .get(&key)
                .map_err(|error| transaction_error(OPERATION, error))?;
            let existing = request_value(request, OPERATION).await?;
            if existing.is_undefined() {
                return Ok(false);
            }
            let request = conflicts
                .delete(&key)
                .map_err(|error| transaction_error(OPERATION, error))?;
            request_value(request, OPERATION).await?;
            Ok(true)
        }
        .await;

        finish_transaction_result(tx, completion, OPERATION, result).await
    }

    pub async fn export_diagnostics(&self) -> Result<DiagnosticExport, RepositoryError> {
        const OPERATION: &str = "export_diagnostics";
        let generated_at_ms = js_sys::Date::now() as i64;

        let (tx, completion) = start_transaction(
            &self.db,
            &[META_STORE, QUARANTINE_STORE, OUTBOX_STORE, PACKS_STORE],
            IdbTransactionMode::Readonly,
            OPERATION,
        )?;

        let result: Result<DiagnosticExport, RepositoryError> = async {
            let meta_store = object_store(&tx, META_STORE, OPERATION)?;
            let quarantine_store = object_store(&tx, QUARANTINE_STORE, OPERATION)?;
            let outbox_store = object_store(&tx, OUTBOX_STORE, OPERATION)?;
            let packs_store = object_store(&tx, PACKS_STORE, OPERATION)?;

            let request = meta_store
                .get(&JsValue::from_str(META_KEY))
                .map_err(|error| transaction_error(OPERATION, error))?;
            let raw_meta = request_value(request, OPERATION).await?;
            if raw_meta.is_undefined() {
                return Err(RepositoryError::MetaCorrupt(
                    "The repository meta record is missing".to_string(),
                ));
            }
            let meta_value = convert::js_to_value(&raw_meta)
                .map_err(|error| RepositoryError::MetaCorrupt(error.to_string()))?;
            let validated_meta = parse_meta(&meta_value)?;
            let meta = serde_json::to_value(&validated_meta)
                .map_err(|error| serialization_error(META_STORE, OPERATION, error))?;

            let quarantine = scan_values(&quarantine_store, OPERATION).await?;

            let outbox_values = scan_values(&outbox_store, OPERATION).await?;
            let mut outbox = validate_outbox_values(outbox_values, &self.device_id, OPERATION)?;
            outbox.sort_by(|left, right| {
                left.device_id
                    .cmp(&right.device_id)
                    .then_with(|| left.seq.cmp(&right.seq))
            });

            let pack_values = scan_values(&packs_store, OPERATION).await?;
            let mut pack_ids = Vec::with_capacity(pack_values.len());
            for value in pack_values {
                let pack_id = value.get("packId").and_then(Value::as_str).ok_or_else(|| {
                    RepositoryError::Serialization(
                        "A pack record has no valid packId during diagnostics".to_string(),
                    )
                })?;
                pack_ids.push(pack_id.to_string());
            }
            pack_ids.sort();

            Ok(DiagnosticExport {
                format_version: DIAGNOSTIC_FORMAT_VERSION,
                generated_at_ms,
                device_id: self.device_id.clone(),
                database_name: DB_NAME.to_string(),
                database_version: DB_VERSION,
                meta,
                recovery: self.recovery_report().clone(),
                quarantine,
                outbox,
                pack_ids,
            })
        }
        .await;

        finish_transaction_result(tx, completion, OPERATION, result).await
    }
}

fn indexed_db_factory() -> Result<IdbFactory, RepositoryError> {
    let window = web_sys::window()
        .ok_or_else(|| RepositoryError::Unavailable("IndexedDB is not available".to_string()))?;
    let factory = window.indexed_db().map_err(|error| {
        RepositoryError::Unavailable(format!(
            "IndexedDB is not available: {}",
            js_value_message(&error)
        ))
    })?;
    factory.ok_or_else(|| RepositoryError::Unavailable("IndexedDB is not available".to_string()))
}

async fn await_open_request(request: IdbOpenDbRequest) -> Result<IdbDatabase, RepositoryError> {
    let promise = Promise::new(&mut |resolve, reject| {
        let request_for_upgrade = request.clone();
        let reject_for_upgrade = reject.clone();
        let upgrade = Closure::once_into_js(move |event: IdbVersionChangeEvent| {
            let outcome = request_for_upgrade
                .result()
                .map_err(|value| js_value_message(&value))
                .and_then(|value| {
                    let db = value.dyn_into::<IdbDatabase>().map_err(|error| {
                        format!("Open request did not return a database: {:?}", error)
                    })?;
                    migrate_database(&db, event.old_version() as u32)
                });

            if let Err(message) = outcome {
                if let Some(transaction) = request_for_upgrade.transaction() {
                    let _ = transaction.abort();
                }
                let _ = reject_for_upgrade.call1(&JsValue::UNDEFINED, &JsValue::from_str(&message));
            }
        });
        request.set_onupgradeneeded(Some(upgrade.unchecked_ref()));

        let request_for_success = request.clone();
        let reject_for_success = reject.clone();
        let success = Closure::once_into_js(move || match request_for_success.result() {
            Ok(value) => {
                let _ = resolve.call1(&JsValue::UNDEFINED, &value);
            }
            Err(error) => {
                let _ = reject_for_success.call1(&JsValue::UNDEFINED, &error);
            }
        });
        request.set_onsuccess(Some(success.unchecked_ref()));

        let request_for_error = request.clone();
        let reject_for_error = reject.clone();
        let error = Closure::once_into_js(move || {
            let value = open_request_error(&request_for_error);
            let _ = reject_for_error.call1(&JsValue::UNDEFINED, &value);
        });
        request.set_onerror(Some(error.unchecked_ref()));

        let blocked = Closure::once_into_js(move || {
            let _ = reject.call1(&JsValue::UNDEFINED, &JsValue::from_str(BLOCKED_REJECTION));
        });
        request.set_onblocked(Some(blocked.unchecked_ref()));
    });

    match JsFuture::from(promise).await {
        Ok(value) => value.dyn_into::<IdbDatabase>().map_err(|error| {
            RepositoryError::Open(format!(
                "Open request did not return an IndexedDB database: {:?}",
                error
            ))
        }),
        Err(error) if error.as_string().as_deref() == Some(BLOCKED_REJECTION) => {
            Err(RepositoryError::Blocked)
        }
        Err(error) => Err(RepositoryError::Open(js_value_message(&error))),
    }
}

fn migrate_database(db: &IdbDatabase, old_version: u32) -> Result<(), String> {
    if old_version != 0 {
        return Err(format!(
            "Unsupported IndexedDB upgrade from version {}",
            old_version
        ));
    }

    let meta = create_store(db, META_STORE, &JsValue::from_str("key"))?;
    let _ = meta;
    create_store(db, PACKS_STORE, &JsValue::from_str("packId"))?;

    let pack_card_key_path = Array::new();
    pack_card_key_path.push(&JsValue::from_str("packId"));
    pack_card_key_path.push(&JsValue::from_str("cardId"));
    let pack_cards = create_store(db, PACK_CARDS_STORE, &pack_card_key_path.into())?;
    create_string_index(&pack_cards, "byPackId", "packId", false)?;

    let outbox = create_store(db, OUTBOX_STORE, &JsValue::from_str("reviewId"))?;
    let device_seq_path = Array::new();
    device_seq_path.push(&JsValue::from_str("deviceId"));
    device_seq_path.push(&JsValue::from_str("seq"));
    create_sequence_index(&outbox, "byDeviceSeq", &device_seq_path.into(), true)?;
    let pack_card_path = Array::new();
    pack_card_path.push(&JsValue::from_str("packId"));
    pack_card_path.push(&JsValue::from_str("cardId"));
    create_sequence_index(&outbox, "byPackCard", &pack_card_path.into(), false)?;

    let conflicts = create_store(db, CONFLICTS_STORE, &JsValue::from_str("conflictId"))?;
    create_string_index(&conflicts, "byReviewId", "reviewId", false)?;

    let quarantine = create_store(db, QUARANTINE_STORE, &JsValue::from_str("quarantineId"))?;
    create_string_index(&quarantine, "bySourceStore", "sourceStore", false)?;
    Ok(())
}

fn create_store(
    db: &IdbDatabase,
    name: &str,
    key_path: &JsValue,
) -> Result<IdbObjectStore, String> {
    let parameters = IdbObjectStoreParameters::new();
    parameters.set_key_path(key_path);
    db.create_object_store_with_optional_parameters(name, &parameters)
        .map_err(|error| {
            format!(
                "Failed to create store {}: {}",
                name,
                js_value_message(&error)
            )
        })
}

fn create_string_index(
    store: &IdbObjectStore,
    name: &str,
    key_path: &str,
    unique: bool,
) -> Result<(), String> {
    let parameters = IdbIndexParameters::new();
    parameters.set_unique(unique);
    store
        .create_index_with_str_and_optional_parameters(name, key_path, &parameters)
        .map(|_| ())
        .map_err(|error| {
            format!(
                "Failed to create index {}: {}",
                name,
                js_value_message(&error)
            )
        })
}

fn create_sequence_index(
    store: &IdbObjectStore,
    name: &str,
    key_path: &JsValue,
    unique: bool,
) -> Result<(), String> {
    let parameters = IdbIndexParameters::new();
    parameters.set_unique(unique);
    store
        .create_index_with_str_sequence_and_optional_parameters(name, key_path, &parameters)
        .map(|_| ())
        .map_err(|error| {
            format!(
                "Failed to create index {}: {}",
                name,
                js_value_message(&error)
            )
        })
}

async fn await_request<T, F>(
    request: IdbRequest,
    operation: &'static str,
    converter: F,
) -> Result<T, RepositoryError>
where
    F: FnOnce(JsValue) -> Result<T, RepositoryError>,
{
    let promise = Promise::new(&mut |resolve, reject| {
        let request_for_success = request.clone();
        let reject_for_success = reject.clone();
        let success = Closure::once_into_js(move || match request_for_success.result() {
            Ok(value) => {
                let _ = resolve.call1(&JsValue::UNDEFINED, &value);
            }
            Err(error) => {
                let _ = reject_for_success.call1(&JsValue::UNDEFINED, &error);
            }
        });
        request.set_onsuccess(Some(success.unchecked_ref()));

        let request_for_error = request.clone();
        let error = Closure::once_into_js(move || {
            let value = request_error_value(&request_for_error);
            let _ = reject.call1(&JsValue::UNDEFINED, &value);
        });
        request.set_onerror(Some(error.unchecked_ref()));
    });

    match JsFuture::from(promise).await {
        Ok(value) => converter(value),
        Err(error) => Err(RepositoryError::Transaction {
            operation,
            message: js_value_message(&error),
        }),
    }
}

async fn request_value(
    request: IdbRequest,
    operation: &'static str,
) -> Result<JsValue, RepositoryError> {
    await_request(request, operation, Ok).await
}

fn monitor_transaction(transaction: &IdbTransaction) -> Promise {
    Promise::new(&mut |resolve, reject| {
        let complete = Closure::once_into_js(move || {
            let _ = resolve.call0(&JsValue::UNDEFINED);
        });
        transaction.set_oncomplete(Some(complete.unchecked_ref()));

        let transaction_for_abort = transaction.clone();
        let reject_for_abort = reject.clone();
        let abort = Closure::once_into_js(move || {
            let value = transaction_error_value(&transaction_for_abort);
            let _ = reject_for_abort.call1(&JsValue::UNDEFINED, &value);
        });
        transaction.set_onabort(Some(abort.unchecked_ref()));

        let transaction_for_error = transaction.clone();
        let reject_for_error = reject.clone();
        let error = Closure::once_into_js(move || {
            let value = transaction_error_value(&transaction_for_error);
            let _ = reject_for_error.call1(&JsValue::UNDEFINED, &value);
        });
        transaction.set_onerror(Some(error.unchecked_ref()));
    })
}

async fn await_transaction(
    completion: Promise,
    operation: &'static str,
) -> Result<(), RepositoryError> {
    JsFuture::from(completion)
        .await
        .map(|_| ())
        .map_err(|error| RepositoryError::Transaction {
            operation,
            message: js_value_message(&error),
        })
}

fn start_transaction(
    db: &IdbDatabase,
    stores: &[&str],
    mode: IdbTransactionMode,
    operation: &'static str,
) -> Result<(IdbTransaction, Promise), RepositoryError> {
    let names = Array::new();
    for store in stores {
        names.push(&JsValue::from_str(store));
    }
    let transaction = db
        .transaction_with_str_sequence_and_mode(&names.into(), mode)
        .map_err(|error| transaction_error(operation, error))?;
    let completion = monitor_transaction(&transaction);
    Ok((transaction, completion))
}

async fn finish_transaction_result<T>(
    transaction: IdbTransaction,
    completion: Promise,
    operation: &'static str,
    result: Result<T, RepositoryError>,
) -> Result<T, RepositoryError> {
    match result {
        Ok(value) => {
            await_transaction(completion, operation).await?;
            Ok(value)
        }
        Err(error) => {
            let _ = transaction.abort();
            let _ = await_transaction(completion, operation).await;
            Err(error)
        }
    }
}

fn object_store(
    transaction: &IdbTransaction,
    name: &str,
    operation: &'static str,
) -> Result<IdbObjectStore, RepositoryError> {
    transaction
        .object_store(name)
        .map_err(|error| transaction_error(operation, error))
}

async fn read_meta_value(db: &IdbDatabase) -> Result<Option<Value>, RepositoryError> {
    const OPERATION: &str = "open_read_meta";
    let (tx, completion) =
        start_transaction(db, &[META_STORE], IdbTransactionMode::Readonly, OPERATION)?;
    let result: Result<Option<Value>, RepositoryError> = async {
        let store = object_store(&tx, META_STORE, OPERATION)?;
        let request = store
            .get(&JsValue::from_str(META_KEY))
            .map_err(|error| transaction_error(OPERATION, error))?;
        let raw = request_value(request, OPERATION).await?;
        if raw.is_undefined() {
            Ok(None)
        } else {
            let value = convert::js_to_value(&raw)
                .map_err(|error| RepositoryError::MetaCorrupt(error.to_string()))?;
            Ok(Some(value))
        }
    }
    .await;
    finish_transaction_result(tx, completion, OPERATION, result).await
}

async fn write_initial_meta(db: &IdbDatabase, meta: &MetaRecord) -> Result<(), RepositoryError> {
    const OPERATION: &str = "initialize_repository";
    let meta_js = record_to_js(meta, META_STORE, OPERATION)?;
    let (tx, completion) =
        start_transaction(db, &[META_STORE], IdbTransactionMode::Readwrite, OPERATION)?;
    let result: Result<(), RepositoryError> = async {
        let store = object_store(&tx, META_STORE, OPERATION)?;
        let request = store
            .put(&meta_js)
            .map_err(|error| transaction_error(OPERATION, error))?;
        request_value(request, OPERATION).await?;
        Ok(())
    }
    .await;
    finish_transaction_result(tx, completion, OPERATION, result).await
}

async fn repository_stores_empty(db: &IdbDatabase) -> Result<bool, RepositoryError> {
    const OPERATION: &str = "open_check_empty";
    let stores = [
        PACKS_STORE,
        PACK_CARDS_STORE,
        OUTBOX_STORE,
        CONFLICTS_STORE,
        QUARANTINE_STORE,
    ];
    let (tx, completion) = start_transaction(db, &stores, IdbTransactionMode::Readonly, OPERATION)?;
    let result: Result<bool, RepositoryError> = async {
        for name in stores {
            let store = object_store(&tx, name, OPERATION)?;
            let request = store
                .count()
                .map_err(|error| transaction_error(OPERATION, error))?;
            let value = request_value(request, OPERATION).await?;
            let count = value.as_f64().ok_or_else(|| {
                RepositoryError::Serialization(format!("Store count for {} was not numeric", name))
            })?;
            if count != 0.0 {
                return Ok(false);
            }
        }
        Ok(true)
    }
    .await;
    finish_transaction_result(tx, completion, OPERATION, result).await
}

fn parse_meta(value: &Value) -> Result<MetaRecord, RepositoryError> {
    if let Some(found) = value.get("schemaVersion").and_then(Value::as_u64) {
        if found != REPOSITORY_SCHEMA_VERSION as u64 {
            let found = match u32::try_from(found) {
                Ok(found) => found,
                Err(_) => u32::MAX,
            };
            return Err(RepositoryError::UnsupportedSchema {
                found,
                supported: REPOSITORY_SCHEMA_VERSION,
            });
        }
    }

    let meta = validate::validate_meta(value)
        .map_err(|failure| RepositoryError::MetaCorrupt(validation_message(&failure)))?;
    if meta.schema_version != REPOSITORY_SCHEMA_VERSION {
        return Err(RepositoryError::UnsupportedSchema {
            found: meta.schema_version,
            supported: REPOSITORY_SCHEMA_VERSION,
        });
    }
    Ok(meta)
}

async fn snapshot_stores(db: &IdbDatabase) -> Result<Snapshots, RepositoryError> {
    const OPERATION: &str = "open_snapshot";
    let (tx, completion) = start_transaction(
        db,
        &ALL_RECOVERY_STORES,
        IdbTransactionMode::Readonly,
        OPERATION,
    )?;
    let result: Result<Snapshots, RepositoryError> = async {
        let meta_store = object_store(&tx, META_STORE, OPERATION)?;
        let _meta = scan_store(&meta_store, OPERATION).await?;
        let packs = scan_store(&object_store(&tx, PACKS_STORE, OPERATION)?, OPERATION).await?;
        let pack_cards =
            scan_store(&object_store(&tx, PACK_CARDS_STORE, OPERATION)?, OPERATION).await?;
        let outbox = scan_store(&object_store(&tx, OUTBOX_STORE, OPERATION)?, OPERATION).await?;
        let conflicts =
            scan_store(&object_store(&tx, CONFLICTS_STORE, OPERATION)?, OPERATION).await?;
        let quarantine =
            scan_values(&object_store(&tx, QUARANTINE_STORE, OPERATION)?, OPERATION).await?;
        Ok(Snapshots {
            packs,
            pack_cards,
            outbox,
            conflicts,
            quarantine,
        })
    }
    .await;
    finish_transaction_result(tx, completion, OPERATION, result).await
}

async fn scan_store(
    store: &IdbObjectStore,
    operation: &'static str,
) -> Result<Vec<RawRecord>, RepositoryError> {
    let values_request = store
        .get_all()
        .map_err(|error| transaction_error(operation, error))?;
    let keys_request = store
        .get_all_keys()
        .map_err(|error| transaction_error(operation, error))?;
    let values = request_value(values_request, operation).await?;
    let keys = request_value(keys_request, operation).await?;
    let values = Array::from(&values);
    let keys = Array::from(&keys);
    if values.length() != keys.length() {
        return Err(RepositoryError::Serialization(format!(
            "IndexedDB snapshot value/key length mismatch during {}",
            operation
        )));
    }

    let mut records = Vec::with_capacity(values.length() as usize);
    for index in 0..values.length() {
        let value = convert::js_to_value(&values.get(index)).map_err(|error| {
            RepositoryError::Serialization(format!(
                "Failed to convert an IndexedDB snapshot during {}: {}",
                operation, error
            ))
        })?;
        records.push(RawRecord {
            key: keys.get(index),
            value,
        });
    }
    Ok(records)
}

async fn scan_values(
    store: &IdbObjectStore,
    operation: &'static str,
) -> Result<Vec<Value>, RepositoryError> {
    let request = store
        .get_all()
        .map_err(|error| transaction_error(operation, error))?;
    let raw_values = request_value(request, operation).await?;
    let mut values = Vec::new();
    for raw in Array::from(&raw_values).iter() {
        values.push(convert::js_to_value(&raw).map_err(|error| {
            RepositoryError::Serialization(format!(
                "Failed to convert an IndexedDB value during {}: {}",
                operation, error
            ))
        })?);
    }
    Ok(values)
}

fn build_recovery_plan(
    meta: &MetaRecord,
    snapshots: Snapshots,
) -> Result<RecoveryPlan, RepositoryError> {
    let detected_at_ms = js_sys::Date::now() as i64;
    let mut quarantines = Vec::new();
    let mut quarantined_outbox = 0u32;
    let mut validated_outbox = Vec::new();

    for raw in snapshots.outbox {
        match validate::validate_outbox_record(&raw.value, &meta.device_id) {
            Ok(record) => validated_outbox.push(record),
            Err(failure) => {
                quarantined_outbox += 1;
                add_quarantine(
                    &mut quarantines,
                    OUTBOX_STORE,
                    &raw,
                    failure.reason,
                    failure.message,
                    detected_at_ms,
                )?;
            }
        }
    }
    validated_outbox.sort_by(|left, right| {
        left.device_id
            .cmp(&right.device_id)
            .then_with(|| left.seq.cmp(&right.seq))
    });
    let split = sequence::split_outbox_prefix(
        validated_outbox.clone(),
        &meta.device_id,
        meta.acked_through_seq,
        meta.next_seq,
    );
    let valid_outbox = split.valid_prefix.len() as u32;
    let deferred_outbox = split.deferred.len() as u32;
    let gaps = split.gaps;

    let mut sending_updates = Vec::new();
    let mut sending_reset = 0u32;
    for mut record in validated_outbox {
        if record.sending {
            record.sending = false;
            sending_reset += 1;
            sending_updates.push(record);
        }
    }

    let mut pack_entries: BTreeMap<String, PackEntry> = BTreeMap::new();
    for raw in snapshots.packs {
        let key_pack_id = convert::js_to_string(&raw.key);
        match validate::validate_pack_record(&raw.value) {
            Ok(pack) => {
                pack_entries.insert(
                    pack.pack_id.clone(),
                    PackEntry {
                        raw,
                        pack: Some(pack),
                        cards: Vec::new(),
                        discard: false,
                    },
                );
            }
            Err(failure) => {
                add_quarantine(
                    &mut quarantines,
                    PACKS_STORE,
                    &raw,
                    failure.reason,
                    failure.message.clone(),
                    detected_at_ms,
                )?;
                if let Some(pack_id) = key_pack_id {
                    pack_entries.insert(
                        pack_id,
                        PackEntry {
                            raw,
                            pack: None,
                            cards: Vec::new(),
                            discard: true,
                        },
                    );
                }
            }
        }
    }

    for raw in snapshots.pack_cards {
        let raw_pack_id = pack_card_pack_id(&raw);
        match validate::validate_pack_card_record(&raw.value) {
            Ok(card) => {
                if let Some(entry) = pack_entries.get_mut(&card.pack_id) {
                    entry.cards.push((raw, card));
                } else {
                    add_quarantine(
                        &mut quarantines,
                        PACK_CARDS_STORE,
                        &raw,
                        "orphanPackCard",
                        format!("No pack record exists for {}", card.pack_id),
                        detected_at_ms,
                    )?;
                }
            }
            Err(failure) => {
                if let Some(pack_id) = raw_pack_id {
                    if let Some(entry) = pack_entries.get_mut(&pack_id) {
                        entry.discard = true;
                    }
                }
                add_quarantine(
                    &mut quarantines,
                    PACK_CARDS_STORE,
                    &raw,
                    failure.reason,
                    failure.message,
                    detected_at_ms,
                )?;
            }
        }
    }

    let mut discarded_pack_ids = Vec::new();
    let mut pack_deletes = Vec::new();
    let mut card_deletes = Vec::new();
    let mut valid_packs = 0u32;

    for (pack_id, mut entry) in pack_entries {
        if entry.pack.is_some() && !entry.discard {
            let mut ordinals = BTreeSet::new();
            let mut ordinals_valid = true;
            for (_, card) in &entry.cards {
                if card.pack_id != pack_id || !ordinals.insert(card.ordinal) {
                    ordinals_valid = false;
                    break;
                }
            }
            if ordinals_valid {
                for (expected, ordinal) in ordinals.iter().enumerate() {
                    if *ordinal != expected as u32 {
                        ordinals_valid = false;
                        break;
                    }
                }
            }

            if !ordinals_valid {
                add_quarantine(
                    &mut quarantines,
                    PACKS_STORE,
                    &entry.raw,
                    "packCards",
                    "Pack cards have duplicate, non-contiguous, or mismatched ordinals".to_string(),
                    detected_at_ms,
                )?;
                entry.discard = true;
            }
        }

        if entry.discard {
            discarded_pack_ids.push(pack_id);
            pack_deletes.push(entry.raw.key.clone());
            for (raw, _) in entry.cards {
                card_deletes.push(raw.key);
            }
        } else if entry.pack.is_some() {
            valid_packs += 1;
        }
    }

    for raw in snapshots.conflicts {
        if let Err(failure) = validate::validate_conflict_record(&raw.value) {
            add_quarantine(
                &mut quarantines,
                CONFLICTS_STORE,
                &raw,
                failure.reason,
                failure.message,
                detected_at_ms,
            )?;
        }
    }

    discarded_pack_ids.sort();
    discarded_pack_ids.dedup();
    let usable = gaps.is_empty();
    let report = RecoveryReport {
        valid_outbox,
        quarantined_outbox,
        deferred_outbox,
        valid_packs,
        discarded_pack_ids,
        quarantined_records: quarantines.len() as u32,
        sending_reset,
        gaps,
        usable,
    };

    Ok(RecoveryPlan {
        quarantines,
        pack_deletes,
        card_deletes,
        sending_updates,
        report,
    })
}

fn add_quarantine(
    plans: &mut Vec<PlannedQuarantine>,
    source_store: &'static str,
    raw: &RawRecord,
    reason: &str,
    message: String,
    detected_at_ms: i64,
) -> Result<(), RepositoryError> {
    let source_key_json = convert::js_to_value(&raw.key)
        .and_then(|value| convert::value_to_js_string(&value))
        .unwrap_or_else(|_| "null".to_string());
    let record_json = convert::value_to_js_string(&raw.value).ok();
    plans.push(PlannedQuarantine {
        source_store,
        source_key: raw.key.clone(),
        record: QuarantineRecord {
            quarantine_id: new_uuid()?,
            source_store: source_store.to_string(),
            source_key_json,
            record: raw.value.clone(),
            record_json,
            reason: reason.to_string(),
            message,
            detected_at_ms,
        },
    });
    Ok(())
}

fn pack_card_pack_id(raw: &RawRecord) -> Option<String> {
    if let Some(pack_id) = raw.value.get("packId").and_then(Value::as_str) {
        return Some(pack_id.to_string());
    }
    let key = convert::js_to_value(&raw.key).ok()?;
    key.as_array()?
        .first()
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

async fn apply_recovery_plan(
    db: &IdbDatabase,
    plan: RecoveryPlan,
) -> Result<RecoveryReport, RepositoryError> {
    const OPERATION: &str = "open_apply_recovery";

    if plan.quarantines.is_empty()
        && plan.pack_deletes.is_empty()
        && plan.card_deletes.is_empty()
        && plan.sending_updates.is_empty()
    {
        return Ok(plan.report);
    }

    let (tx, completion) = start_transaction(
        db,
        &ALL_RECOVERY_STORES,
        IdbTransactionMode::Readwrite,
        OPERATION,
    )?;
    let RecoveryPlan {
        quarantines,
        pack_deletes,
        card_deletes,
        sending_updates,
        report,
    } = plan;

    let result: Result<RecoveryReport, RepositoryError> = async {
        let quarantine_store = object_store(&tx, QUARANTINE_STORE, OPERATION)?;
        for planned in quarantines {
            let record_js = record_to_js(&planned.record, QUARANTINE_STORE, OPERATION)?;
            let request = quarantine_store
                .put(&record_js)
                .map_err(|error| transaction_error(OPERATION, error))?;
            request_value(request, OPERATION).await?;

            let source = object_store(&tx, planned.source_store, OPERATION)?;
            let request = source
                .delete(&planned.source_key)
                .map_err(|error| transaction_error(OPERATION, error))?;
            request_value(request, OPERATION).await?;
        }

        let packs = object_store(&tx, PACKS_STORE, OPERATION)?;
        for key in pack_deletes {
            let request = packs
                .delete(&key)
                .map_err(|error| transaction_error(OPERATION, error))?;
            request_value(request, OPERATION).await?;
        }

        let cards = object_store(&tx, PACK_CARDS_STORE, OPERATION)?;
        for key in card_deletes {
            let request = cards
                .delete(&key)
                .map_err(|error| transaction_error(OPERATION, error))?;
            request_value(request, OPERATION).await?;
        }

        let outbox = object_store(&tx, OUTBOX_STORE, OPERATION)?;
        for record in sending_updates {
            let record_js = record_to_js(&record, OUTBOX_STORE, OPERATION)?;
            let request = outbox
                .put(&record_js)
                .map_err(|error| transaction_error(OPERATION, error))?;
            request_value(request, OPERATION).await?;
        }

        Ok(report)
    }
    .await;

    finish_transaction_result(tx, completion, OPERATION, result).await
}

fn validate_outbox_values(
    values: Vec<Value>,
    device_id: &str,
    operation: &'static str,
) -> Result<Vec<OutboxRecord>, RepositoryError> {
    let mut records = Vec::with_capacity(values.len());
    for value in values {
        let review_id = value
            .get("reviewId")
            .and_then(Value::as_str)
            .unwrap_or("<unknown>")
            .to_string();
        let record = validate::validate_outbox_record(&value, device_id).map_err(|failure| {
            RepositoryError::Serialization(format!(
                "Invalid outbox record {} during {}: {}",
                review_id,
                operation,
                validation_message(&failure)
            ))
        })?;
        records.push(record);
    }
    records.sort_by(|left, right| {
        left.device_id
            .cmp(&right.device_id)
            .then_with(|| left.seq.cmp(&right.seq))
    });
    Ok(records)
}

fn compound_pack_card_key(pack_id: &str, card_id: &str) -> JsValue {
    let key = Array::new();
    key.push(&JsValue::from_str(pack_id));
    key.push(&JsValue::from_str(card_id));
    key.into()
}

fn record_to_js<T: Serialize>(
    record: &T,
    store: &str,
    operation: &'static str,
) -> Result<JsValue, RepositoryError> {
    let value = serde_json::to_value(record)
        .map_err(|error| serialization_error(store, operation, error))?;
    convert::value_to_js(&value).map_err(|error| {
        RepositoryError::Serialization(format!(
            "Failed to serialize {} record during {}: {}",
            store, operation, error
        ))
    })
}

fn serialization_error(
    store: &str,
    operation: &str,
    error: impl std::fmt::Display,
) -> RepositoryError {
    RepositoryError::Serialization(format!(
        "Failed to serialize {} record during {}: {}",
        store, operation, error
    ))
}

fn validation_invalid_input(failure: validate::ValidationFailure) -> RepositoryError {
    RepositoryError::InvalidInput(validation_message(&failure))
}

fn validation_message(failure: &validate::ValidationFailure) -> String {
    if failure.message.is_empty() {
        failure.reason.to_string()
    } else {
        format!("{}: {}", failure.reason, failure.message)
    }
}

fn transaction_error(operation: &'static str, error: JsValue) -> RepositoryError {
    RepositoryError::Transaction {
        operation,
        message: js_value_message(&error),
    }
}

fn js_value_message(value: &JsValue) -> String {
    if let Some(exception) = value.dyn_ref::<DomException>() {
        let name = exception.name();
        let message = exception.message();
        if name.is_empty() {
            message
        } else if message.is_empty() {
            name
        } else {
            format!("{}: {}", name, message)
        }
    } else if let Some(message) = value.as_string() {
        message
    } else {
        format!("{:?}", value)
    }
}

fn open_request_error(request: &IdbOpenDbRequest) -> JsValue {
    match request.error() {
        Ok(Some(error)) => error.into(),
        Ok(None) => JsValue::from_str("IndexedDB open request failed"),
        Err(error) => error,
    }
}

fn request_error_value(request: &IdbRequest) -> JsValue {
    match request.error() {
        Ok(Some(error)) => error.into(),
        Ok(None) => JsValue::from_str("IndexedDB request failed"),
        Err(error) => error,
    }
}

fn transaction_error_value(transaction: &IdbTransaction) -> JsValue {
    match transaction.error() {
        Some(error) => error.into(),
        None => JsValue::from_str("IndexedDB transaction failed or was aborted"),
    }
}

fn new_uuid() -> Result<String, RepositoryError> {
    let window = web_sys::window().ok_or_else(|| {
        RepositoryError::Unavailable("Secure random UUID generation is unavailable".to_string())
    })?;
    let crypto = window.crypto().map_err(|error| {
        RepositoryError::Unavailable(format!(
            "Secure random UUID generation is unavailable: {}",
            js_value_message(&error)
        ))
    })?;
    let mut bytes = [0u8; 16];
    crypto
        .get_random_values_with_u8_array(&mut bytes)
        .map_err(|error| {
            RepositoryError::Unavailable(format!(
                "Secure random UUID generation failed: {}",
                js_value_message(&error)
            ))
        })?;

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut uuid = String::with_capacity(36);
    for (index, byte) in bytes.iter().enumerate() {
        if matches!(index, 4 | 6 | 8 | 10) {
            uuid.push('-');
        }
        uuid.push(HEX[(byte >> 4) as usize] as char);
        uuid.push(HEX[(byte & 0x0f) as usize] as char);
    }
    Ok(uuid)
}
