use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PackCardData {
    pub card_id: String,
    pub ordinal: u32,
    pub reps: u32,
    pub payload: serde_json::Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PackData {
    pub pack_id: String,
    pub server_revision: String,
    pub server_time_ms: i64,
    pub server_time_offset_ms: i64,
    pub payload: serde_json::Value,
    pub cards: Vec<PackCardData>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackRecord {
    pub pack_id: String,
    pub schema_version: u32,
    pub server_revision: String,
    pub server_time_ms: i64,
    pub server_time_offset_ms: i64,
    pub payload: serde_json::Value,
    pub payload_hash: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackCardRecord {
    pub pack_id: String,
    pub card_id: String,
    pub schema_version: u32,
    pub ordinal: u32,
    pub reps: u32,
    pub answered: bool,
    pub payload: serde_json::Value,
    pub payload_hash: String,
}

/// A stored pack and its cards, with cards sorted by ordinal and then card ID.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoredPack {
    pub pack: PackRecord,
    pub cards: Vec<PackCardRecord>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NewReview {
    pub pack_id: String,
    pub card_id: String,
    pub rating: u8,
    pub expected_reps: u32,
    pub elapsed_ms: u64,
    pub client_occurred_at_ms: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewPayload {
    pub review_id: String,
    pub device_id: String,
    pub seq: u64,
    pub pack_id: String,
    pub card_id: String,
    pub rating: u8,
    pub expected_reps: u32,
    pub elapsed_ms: u64,
    pub client_occurred_at_ms: i64,
    pub pack_server_time_ms: i64,
    pub pack_server_time_offset_ms: i64,
    pub payload_schema_version: u32,
}

impl ReviewPayload {
    pub fn into_outbox(self, sending: bool, payload_hash: String) -> OutboxRecord {
        OutboxRecord {
            review_id: self.review_id,
            device_id: self.device_id,
            seq: self.seq,
            pack_id: self.pack_id,
            card_id: self.card_id,
            rating: self.rating,
            expected_reps: self.expected_reps,
            elapsed_ms: self.elapsed_ms,
            client_occurred_at_ms: self.client_occurred_at_ms,
            pack_server_time_ms: self.pack_server_time_ms,
            pack_server_time_offset_ms: self.pack_server_time_offset_ms,
            payload_schema_version: self.payload_schema_version,
            sending,
            payload_hash,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutboxRecord {
    pub review_id: String,
    pub device_id: String,
    pub seq: u64,
    pub pack_id: String,
    pub card_id: String,
    pub rating: u8,
    pub expected_reps: u32,
    pub elapsed_ms: u64,
    pub client_occurred_at_ms: i64,
    pub pack_server_time_ms: i64,
    pub pack_server_time_offset_ms: i64,
    pub payload_schema_version: u32,
    pub sending: bool,
    pub payload_hash: String,
}

impl OutboxRecord {
    pub fn payload(&self) -> ReviewPayload {
        ReviewPayload {
            review_id: self.review_id.clone(),
            device_id: self.device_id.clone(),
            seq: self.seq,
            pack_id: self.pack_id.clone(),
            card_id: self.card_id.clone(),
            rating: self.rating,
            expected_reps: self.expected_reps,
            elapsed_ms: self.elapsed_ms,
            client_occurred_at_ms: self.client_occurred_at_ms,
            pack_server_time_ms: self.pack_server_time_ms,
            pack_server_time_offset_ms: self.pack_server_time_offset_ms,
            payload_schema_version: self.payload_schema_version,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NewConflict {
    pub review: OutboxRecord,
    pub reason: String,
    pub server_response: Option<serde_json::Value>,
    pub detected_at_ms: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConflictRecord {
    pub conflict_id: String,
    pub review_id: String,
    pub device_id: String,
    pub seq: u64,
    pub pack_id: String,
    pub card_id: String,
    pub reason: String,
    pub local_review: ReviewPayload,
    pub server_response: Option<serde_json::Value>,
    pub detected_at_ms: i64,
}

/// One item of a resolved sync prefix: either acknowledged by the server
/// (accepted or duplicate-of-accepted) or parked as a durable conflict.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutcome {
    pub review_id: String,
    pub kind: SyncOutcomeKind,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncOutcomeKind {
    Ack,
    Conflict {
        reason: String,
        server_response: Option<serde_json::Value>,
    },
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PersistenceStatus {
    Granted,
    NotGranted,
    Unavailable,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SequenceGap {
    pub device_id: String,
    pub expected_seq: u64,
    /// `None` means the sequence ends before `meta.nextSeq` says it should.
    pub found_seq: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryReport {
    pub valid_outbox: u32,
    pub quarantined_outbox: u32,
    pub deferred_outbox: u32,
    pub valid_packs: u32,
    pub discarded_pack_ids: Vec<String>,
    pub quarantined_records: u32,
    pub sending_reset: u32,
    pub gaps: Vec<SequenceGap>,
    pub usable: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenReport {
    pub device_id: String,
    pub persistence: PersistenceStatus,
    pub recovery: RecoveryReport,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticExport {
    pub format_version: u32,
    pub generated_at_ms: i64,
    pub device_id: String,
    pub database_name: String,
    pub database_version: u32,
    pub meta: serde_json::Value,
    pub recovery: RecoveryReport,
    pub quarantine: Vec<serde_json::Value>,
    pub outbox: Vec<OutboxRecord>,
    pub pack_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetaRecord {
    pub key: String,
    pub schema_version: u32,
    pub device_id: String,
    pub next_seq: u64,
    pub acked_through_seq: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuarantineRecord {
    pub quarantine_id: String,
    pub source_store: String,
    pub source_key_json: String,
    pub record: serde_json::Value,
    pub record_json: Option<String>,
    pub reason: String,
    pub message: String,
    pub detected_at_ms: i64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum RepositoryError {
    Unavailable(String),
    Open(String),
    Blocked,
    UnsupportedSchema {
        found: u32,
        supported: u32,
    },
    MetaCorrupt(String),
    Serialization(String),
    Transaction {
        operation: &'static str,
        message: String,
    },
    InvalidInput(String),
    PackNotFound(String),
    CardNotFound {
        pack_id: String,
        card_id: String,
    },
    CardAlreadyAnswered {
        pack_id: String,
        card_id: String,
    },
    RepsMismatch {
        expected: u32,
        actual: u32,
    },
    AckNotContiguous(String),
    RecoveryRequired,
    SequenceExhausted,
}

impl fmt::Display for RepositoryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable(message) => write!(formatter, "repository unavailable: {message}"),
            Self::Open(message) => write!(formatter, "failed to open repository: {message}"),
            Self::Blocked => write!(formatter, "repository open is blocked"),
            Self::UnsupportedSchema { found, supported } => write!(
                formatter,
                "unsupported schema version {found}; supported version is {supported}"
            ),
            Self::MetaCorrupt(message) => {
                write!(formatter, "repository metadata is corrupt: {message}")
            }
            Self::Serialization(message) => write!(formatter, "serialization failed: {message}"),
            Self::Transaction { operation, message } => {
                write!(
                    formatter,
                    "transaction failed during {operation}: {message}"
                )
            }
            Self::InvalidInput(message) => write!(formatter, "invalid input: {message}"),
            Self::PackNotFound(pack_id) => write!(formatter, "pack not found: {pack_id}"),
            Self::CardNotFound { pack_id, card_id } => {
                write!(formatter, "card not found: pack {pack_id}, card {card_id}")
            }
            Self::CardAlreadyAnswered { pack_id, card_id } => write!(
                formatter,
                "card has already been answered: pack {pack_id}, card {card_id}"
            ),
            Self::RepsMismatch { expected, actual } => {
                write!(
                    formatter,
                    "reps mismatch: expected {expected}, actual {actual}"
                )
            }
            Self::AckNotContiguous(message) => {
                write!(formatter, "acknowledgement is not contiguous: {message}")
            }
            Self::RecoveryRequired => write!(formatter, "repository recovery is required"),
            Self::SequenceExhausted => write!(formatter, "review sequence is exhausted"),
        }
    }
}

impl std::error::Error for RepositoryError {}
