pub mod hash;
pub mod model;
pub mod sequence;
pub mod validate;

pub use hash::{canonical_json, pack_card_hash, pack_hash, review_payload_hash, sha256_hex};
pub use model::*;
pub use sequence::{split_outbox_prefix, validate_ack_prefix, SequenceSplit};
pub use validate::{
    as_i64_safe, as_u64_safe, check_no_unknown_fields, is_canonical_uuid, is_valid_id,
    validate_conflict_record, validate_meta, validate_new_review, validate_outbox_record,
    validate_pack_card_record, validate_pack_record, ValidationFailure,
};

pub const DB_NAME: &str = "srep-client";
pub const DB_VERSION: u32 = 1;
pub const REPOSITORY_SCHEMA_VERSION: u32 = 1;
pub const PACK_SCHEMA_VERSION: u32 = 1;
pub const OUTBOX_PAYLOAD_SCHEMA_VERSION: u32 = 1;
pub const DIAGNOSTIC_FORMAT_VERSION: u32 = 1;
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
