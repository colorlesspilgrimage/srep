use super::hash::{pack_card_hash, pack_hash, review_payload_hash};
use super::model::{
    ConflictRecord, MetaRecord, NewReview, OutboxRecord, PackCardRecord, PackRecord,
    RepositoryError, ReviewPayload,
};
use super::{
    MAX_SAFE_INTEGER, OUTBOX_PAYLOAD_SCHEMA_VERSION, PACK_SCHEMA_VERSION, REPOSITORY_SCHEMA_VERSION,
};
use serde_json::{Map, Value};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValidationFailure {
    pub reason: &'static str,
    pub message: String,
}

fn failure(reason: &'static str, message: impl Into<String>) -> ValidationFailure {
    ValidationFailure {
        reason,
        message: message.into(),
    }
}

pub fn is_canonical_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 36 {
        return false;
    }

    bytes.iter().enumerate().all(|(index, byte)| {
        if matches!(index, 8 | 13 | 18 | 23) {
            *byte == b'-'
        } else {
            byte.is_ascii_digit() || (b'a'..=b'f').contains(byte)
        }
    })
}

pub fn is_valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && !value.chars().any(|character| character.is_control())
}

pub fn as_u64_safe(value: &Value) -> Option<u64> {
    value.as_u64().filter(|number| *number <= MAX_SAFE_INTEGER)
}

pub fn as_i64_safe(value: &Value) -> Option<i64> {
    const MAX_SAFE_I64: i64 = MAX_SAFE_INTEGER as i64;

    value
        .as_i64()
        .filter(|number| (-MAX_SAFE_I64..=MAX_SAFE_I64).contains(number))
}

pub fn check_no_unknown_fields(value: &Value, allowed: &[&str]) -> Result<(), ValidationFailure> {
    let object = value
        .as_object()
        .ok_or_else(|| failure("schema", "record root must be a JSON object"))?;

    let mut unknown_fields: Vec<&str> = object
        .keys()
        .filter(|key| !allowed.contains(&key.as_str()))
        .map(String::as_str)
        .collect();
    unknown_fields.sort_unstable();

    if let Some(field) = unknown_fields.first() {
        return Err(failure(
            "schema",
            format!("unknown field `{field}` on record"),
        ));
    }
    Ok(())
}

fn checked_object<'a>(
    value: &'a Value,
    allowed: &[&str],
) -> Result<&'a Map<String, Value>, ValidationFailure> {
    check_no_unknown_fields(value, allowed)?;
    match value {
        Value::Object(object) => Ok(object),
        _ => Err(failure("schema", "record root must be a JSON object")),
    }
}

fn required_value<'a>(
    object: &'a Map<String, Value>,
    field: &str,
) -> Result<&'a Value, ValidationFailure> {
    object.get(field).ok_or_else(|| {
        failure(
            "requiredField",
            format!("required field `{field}` is missing"),
        )
    })
}

fn required_str<'a>(
    object: &'a Map<String, Value>,
    field: &str,
) -> Result<&'a str, ValidationFailure> {
    required_value(object, field)?.as_str().ok_or_else(|| {
        failure(
            "requiredField",
            format!("required field `{field}` must be a string"),
        )
    })
}

fn required_string(object: &Map<String, Value>, field: &str) -> Result<String, ValidationFailure> {
    required_str(object, field).map(str::to_owned)
}

fn required_bool(object: &Map<String, Value>, field: &str) -> Result<bool, ValidationFailure> {
    required_value(object, field)?.as_bool().ok_or_else(|| {
        failure(
            "requiredField",
            format!("required field `{field}` must be a boolean"),
        )
    })
}

fn required_u64_safe(object: &Map<String, Value>, field: &str) -> Result<u64, ValidationFailure> {
    as_u64_safe(required_value(object, field)?).ok_or_else(|| {
        failure(
            "requiredField",
            format!("required field `{field}` must be a safe nonnegative integer"),
        )
    })
}

fn required_i64_safe(object: &Map<String, Value>, field: &str) -> Result<i64, ValidationFailure> {
    as_i64_safe(required_value(object, field)?).ok_or_else(|| {
        failure(
            "requiredField",
            format!("required field `{field}` must be a safe integer"),
        )
    })
}

fn required_u32_safe(object: &Map<String, Value>, field: &str) -> Result<u32, ValidationFailure> {
    let value = required_u64_safe(object, field)?;
    u32::try_from(value).map_err(|_| {
        failure(
            "requiredField",
            format!("required field `{field}` must fit in an unsigned 32-bit integer"),
        )
    })
}

fn required_schema_version(
    object: &Map<String, Value>,
    expected: u32,
) -> Result<u32, ValidationFailure> {
    let found = required_u64_safe(object, "schemaVersion")?;
    if found != u64::from(expected) {
        return Err(failure(
            "schema",
            format!("unsupported schemaVersion {found}; expected {expected}"),
        ));
    }
    Ok(expected)
}

fn required_payload_schema_version(object: &Map<String, Value>) -> Result<u32, ValidationFailure> {
    let found = required_u64_safe(object, "payloadSchemaVersion")?;
    if found != u64::from(OUTBOX_PAYLOAD_SCHEMA_VERSION) {
        return Err(failure(
            "schema",
            format!(
                "unsupported payloadSchemaVersion {found}; expected {OUTBOX_PAYLOAD_SCHEMA_VERSION}"
            ),
        ));
    }
    Ok(OUTBOX_PAYLOAD_SCHEMA_VERSION)
}

fn is_lower_hex_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Validates metadata in stage order: object/schema, required fields and ranges,
/// then canonical device UUID.
pub fn validate_meta(value: &Value) -> Result<MetaRecord, ValidationFailure> {
    const FIELDS: &[&str] = &[
        "key",
        "schemaVersion",
        "deviceId",
        "nextSeq",
        "ackedThroughSeq",
    ];

    let object = checked_object(value, FIELDS)?;
    let key = required_string(object, "key")?;
    if key != "repository" {
        return Err(failure(
            "requiredField",
            "metadata key must be `repository`",
        ));
    }
    let schema_version = required_schema_version(object, REPOSITORY_SCHEMA_VERSION)?;
    let device_id = required_string(object, "deviceId")?;
    let next_seq = required_u64_safe(object, "nextSeq")?;
    let acked_through_seq = required_u64_safe(object, "ackedThroughSeq")?;
    if next_seq < 1 {
        return Err(failure("requiredField", "nextSeq must be at least 1"));
    }
    if acked_through_seq >= next_seq {
        return Err(failure(
            "requiredField",
            "ackedThroughSeq must be less than nextSeq",
        ));
    }

    if !is_canonical_uuid(&device_id) {
        return Err(failure(
            "invalidId",
            "deviceId must be a canonical lowercase UUID",
        ));
    }

    Ok(MetaRecord {
        key,
        schema_version,
        device_id,
        next_seq,
        acked_through_seq,
    })
}

/// Validates a pack in stage order: object/schema, required primitive fields,
/// pack ID, then payload-hash shape and recomputation.
pub fn validate_pack_record(value: &Value) -> Result<PackRecord, ValidationFailure> {
    const FIELDS: &[&str] = &[
        "packId",
        "schemaVersion",
        "serverRevision",
        "serverTimeMs",
        "serverTimeOffsetMs",
        "payload",
        "payloadHash",
    ];

    let object = checked_object(value, FIELDS)?;
    let pack_id = required_string(object, "packId")?;
    let schema_version = required_schema_version(object, PACK_SCHEMA_VERSION)?;
    let server_revision = required_string(object, "serverRevision")?;
    let server_time_ms = required_i64_safe(object, "serverTimeMs")?;
    let server_time_offset_ms = required_i64_safe(object, "serverTimeOffsetMs")?;
    let payload = required_value(object, "payload")?.clone();
    let payload_hash = required_string(object, "payloadHash")?;

    if !is_valid_id(&pack_id) {
        return Err(failure("invalidId", "packId is not a valid ID"));
    }

    let record = PackRecord {
        pack_id,
        schema_version,
        server_revision,
        server_time_ms,
        server_time_offset_ms,
        payload,
        payload_hash,
    };
    let expected_hash = pack_hash(
        &record.pack_id,
        record.schema_version,
        &record.server_revision,
        record.server_time_ms,
        record.server_time_offset_ms,
        &record.payload,
    );
    if !is_lower_hex_hash(&record.payload_hash) || record.payload_hash != expected_hash {
        return Err(failure(
            "payloadHash",
            "pack payloadHash is malformed or does not match its contents",
        ));
    }

    Ok(record)
}

/// Validates a pack card in stage order: object/schema, required primitive
/// fields and ranges, pack/card IDs, then payload-hash recomputation.
pub fn validate_pack_card_record(value: &Value) -> Result<PackCardRecord, ValidationFailure> {
    const FIELDS: &[&str] = &[
        "packId",
        "cardId",
        "schemaVersion",
        "ordinal",
        "reps",
        "answered",
        "payload",
        "payloadHash",
    ];

    let object = checked_object(value, FIELDS)?;
    let pack_id = required_string(object, "packId")?;
    let card_id = required_string(object, "cardId")?;
    let schema_version = required_schema_version(object, PACK_SCHEMA_VERSION)?;
    let ordinal = required_u32_safe(object, "ordinal")?;
    let reps = required_u32_safe(object, "reps")?;
    let answered = required_bool(object, "answered")?;
    let payload = required_value(object, "payload")?.clone();
    let payload_hash = required_string(object, "payloadHash")?;

    if !is_valid_id(&pack_id) {
        return Err(failure("invalidId", "packId is not a valid ID"));
    }
    if !is_valid_id(&card_id) {
        return Err(failure("invalidId", "cardId is not a valid ID"));
    }

    let record = PackCardRecord {
        pack_id,
        card_id,
        schema_version,
        ordinal,
        reps,
        answered,
        payload,
        payload_hash,
    };
    let expected_hash = pack_card_hash(
        &record.pack_id,
        &record.card_id,
        record.schema_version,
        record.ordinal,
        record.reps,
        &record.payload,
    );
    if !is_lower_hex_hash(&record.payload_hash) || record.payload_hash != expected_hash {
        return Err(failure(
            "payloadHash",
            "pack-card payloadHash is malformed or does not match its contents",
        ));
    }

    Ok(record)
}

/// Validates an outbox record in stage order: object/schema, required fields
/// and numeric ranges, IDs/device ownership, then ReviewPayload hash.
pub fn validate_outbox_record(
    value: &Value,
    expected_device_id: &str,
) -> Result<OutboxRecord, ValidationFailure> {
    const FIELDS: &[&str] = &[
        "reviewId",
        "deviceId",
        "seq",
        "packId",
        "cardId",
        "rating",
        "expectedReps",
        "elapsedMs",
        "clientOccurredAtMs",
        "packServerTimeMs",
        "packServerTimeOffsetMs",
        "payloadSchemaVersion",
        "sending",
        "payloadHash",
    ];

    let object = checked_object(value, FIELDS)?;
    let review_id = required_string(object, "reviewId")?;
    let device_id = required_string(object, "deviceId")?;
    let seq = required_u64_safe(object, "seq")?;
    if seq < 1 {
        return Err(failure("requiredField", "seq must be at least 1"));
    }
    let pack_id = required_string(object, "packId")?;
    let card_id = required_string(object, "cardId")?;
    let rating = required_u64_safe(object, "rating")?;
    if !(1..=4).contains(&rating) {
        return Err(failure(
            "requiredField",
            "rating must be an integer in the range 1..=4",
        ));
    }
    let expected_reps = required_u32_safe(object, "expectedReps")?;
    let elapsed_ms = required_u64_safe(object, "elapsedMs")?;
    let client_occurred_at_ms = required_i64_safe(object, "clientOccurredAtMs")?;
    let pack_server_time_ms = required_i64_safe(object, "packServerTimeMs")?;
    let pack_server_time_offset_ms = required_i64_safe(object, "packServerTimeOffsetMs")?;
    let payload_schema_version = required_payload_schema_version(object)?;
    let sending = required_bool(object, "sending")?;
    let payload_hash = required_string(object, "payloadHash")?;

    if !is_canonical_uuid(&review_id) {
        return Err(failure(
            "invalidId",
            "reviewId must be a canonical lowercase UUID",
        ));
    }
    if !is_canonical_uuid(&device_id) {
        return Err(failure(
            "invalidId",
            "deviceId must be a canonical lowercase UUID",
        ));
    }
    if device_id != expected_device_id {
        return Err(failure(
            "invalidId",
            "outbox deviceId does not match repository deviceId",
        ));
    }
    if !is_valid_id(&pack_id) {
        return Err(failure("invalidId", "packId is not a valid ID"));
    }
    if !is_valid_id(&card_id) {
        return Err(failure("invalidId", "cardId is not a valid ID"));
    }

    let payload = ReviewPayload {
        review_id,
        device_id,
        seq,
        pack_id,
        card_id,
        rating: rating as u8,
        expected_reps,
        elapsed_ms,
        client_occurred_at_ms,
        pack_server_time_ms,
        pack_server_time_offset_ms,
        payload_schema_version,
    };
    let expected_hash = review_payload_hash(&payload);
    if !is_lower_hex_hash(&payload_hash) || payload_hash != expected_hash {
        return Err(failure(
            "payloadHash",
            "outbox payloadHash is malformed or does not match its ReviewPayload",
        ));
    }

    Ok(payload.into_outbox(sending, payload_hash))
}

/// Validates a conflict in stage order: object/schema, required fields and the
/// embedded ReviewPayload shape/ranges, then top-level IDs. The embedded review
/// applies the outbox checks except for `sending` and `payloadHash`.
pub fn validate_conflict_record(value: &Value) -> Result<ConflictRecord, ValidationFailure> {
    const FIELDS: &[&str] = &[
        "conflictId",
        "reviewId",
        "deviceId",
        "seq",
        "packId",
        "cardId",
        "reason",
        "localReview",
        "serverResponse",
        "detectedAtMs",
    ];

    let object = checked_object(value, FIELDS)?;
    let conflict_id = required_string(object, "conflictId")?;
    let review_id = required_string(object, "reviewId")?;
    let device_id = required_string(object, "deviceId")?;
    let seq = required_u64_safe(object, "seq")?;
    if seq < 1 {
        return Err(failure("requiredField", "seq must be at least 1"));
    }
    let pack_id = required_string(object, "packId")?;
    let card_id = required_string(object, "cardId")?;
    let reason = required_string(object, "reason")?;
    if reason.is_empty() {
        return Err(failure("requiredField", "reason must not be empty"));
    }
    let local_review = validate_embedded_review_payload(required_value(object, "localReview")?)?;
    let server_response = match required_value(object, "serverResponse")? {
        Value::Null => None,
        value => Some(value.clone()),
    };
    let detected_at_ms = required_i64_safe(object, "detectedAtMs")?;

    if !is_canonical_uuid(&conflict_id) {
        return Err(failure(
            "invalidId",
            "conflictId must be a canonical lowercase UUID",
        ));
    }
    if !is_canonical_uuid(&review_id) {
        return Err(failure(
            "invalidId",
            "reviewId must be a canonical lowercase UUID",
        ));
    }
    if !is_canonical_uuid(&device_id) {
        return Err(failure(
            "invalidId",
            "deviceId must be a canonical lowercase UUID",
        ));
    }
    if !is_valid_id(&pack_id) {
        return Err(failure("invalidId", "packId is not a valid ID"));
    }
    if !is_valid_id(&card_id) {
        return Err(failure("invalidId", "cardId is not a valid ID"));
    }

    Ok(ConflictRecord {
        conflict_id,
        review_id,
        device_id,
        seq,
        pack_id,
        card_id,
        reason,
        local_review,
        server_response,
        detected_at_ms,
    })
}

fn validate_embedded_review_payload(value: &Value) -> Result<ReviewPayload, ValidationFailure> {
    const FIELDS: &[&str] = &[
        "reviewId",
        "deviceId",
        "seq",
        "packId",
        "cardId",
        "rating",
        "expectedReps",
        "elapsedMs",
        "clientOccurredAtMs",
        "packServerTimeMs",
        "packServerTimeOffsetMs",
        "payloadSchemaVersion",
    ];

    let object = checked_object(value, FIELDS)?;
    let review_id = required_string(object, "reviewId")?;
    let device_id = required_string(object, "deviceId")?;
    let seq = required_u64_safe(object, "seq")?;
    if seq < 1 {
        return Err(failure(
            "requiredField",
            "localReview.seq must be at least 1",
        ));
    }
    let pack_id = required_string(object, "packId")?;
    let card_id = required_string(object, "cardId")?;
    let rating = required_u64_safe(object, "rating")?;
    if !(1..=4).contains(&rating) {
        return Err(failure(
            "requiredField",
            "localReview.rating must be an integer in the range 1..=4",
        ));
    }
    let expected_reps = required_u32_safe(object, "expectedReps")?;
    let elapsed_ms = required_u64_safe(object, "elapsedMs")?;
    let client_occurred_at_ms = required_i64_safe(object, "clientOccurredAtMs")?;
    let pack_server_time_ms = required_i64_safe(object, "packServerTimeMs")?;
    let pack_server_time_offset_ms = required_i64_safe(object, "packServerTimeOffsetMs")?;
    let payload_schema_version = required_payload_schema_version(object)?;

    if !is_canonical_uuid(&review_id) {
        return Err(failure(
            "invalidId",
            "localReview.reviewId must be a canonical lowercase UUID",
        ));
    }
    if !is_canonical_uuid(&device_id) {
        return Err(failure(
            "invalidId",
            "localReview.deviceId must be a canonical lowercase UUID",
        ));
    }
    if !is_valid_id(&pack_id) {
        return Err(failure("invalidId", "localReview.packId is not a valid ID"));
    }
    if !is_valid_id(&card_id) {
        return Err(failure("invalidId", "localReview.cardId is not a valid ID"));
    }

    Ok(ReviewPayload {
        review_id,
        device_id,
        seq,
        pack_id,
        card_id,
        rating: rating as u8,
        expected_reps,
        elapsed_ms,
        client_occurred_at_ms,
        pack_server_time_ms,
        pack_server_time_offset_ms,
        payload_schema_version,
    })
}

pub fn validate_new_review(review: &NewReview) -> Result<(), RepositoryError> {
    const MAX_SAFE_I64: i64 = MAX_SAFE_INTEGER as i64;

    if !is_valid_id(&review.pack_id) {
        return Err(RepositoryError::InvalidInput(
            "pack_id must be a valid ID".to_owned(),
        ));
    }
    if !is_valid_id(&review.card_id) {
        return Err(RepositoryError::InvalidInput(
            "card_id must be a valid ID".to_owned(),
        ));
    }
    if !(1..=4).contains(&review.rating) {
        return Err(RepositoryError::InvalidInput(
            "rating must be in the range 1..=4".to_owned(),
        ));
    }
    if !(-MAX_SAFE_I64..=MAX_SAFE_I64).contains(&review.client_occurred_at_ms) {
        return Err(RepositoryError::InvalidInput(
            "client_occurred_at_ms must be a safe JSON integer".to_owned(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const DEVICE: &str = "123e4567-e89b-42d3-a456-426614174000";
    const REVIEW: &str = "123e4567-e89b-42d3-a456-426614174001";
    const CONFLICT: &str = "123e4567-e89b-42d3-a456-426614174002";

    fn review_payload() -> ReviewPayload {
        ReviewPayload {
            review_id: REVIEW.to_owned(),
            device_id: DEVICE.to_owned(),
            seq: 1,
            pack_id: "pack-1".to_owned(),
            card_id: "card-1".to_owned(),
            rating: 3,
            expected_reps: 2,
            elapsed_ms: 100,
            client_occurred_at_ms: 1_000,
            pack_server_time_ms: 900,
            pack_server_time_offset_ms: 10,
            payload_schema_version: OUTBOX_PAYLOAD_SCHEMA_VERSION,
        }
    }

    fn valid_outbox() -> Value {
        let payload = review_payload();
        let hash = review_payload_hash(&payload);
        serde_json::to_value(payload.into_outbox(false, hash))
            .expect("test outbox serialization should succeed")
    }

    fn valid_pack() -> Value {
        let payload = json!({"b": 1, "a": 2});
        let hash = pack_hash(
            "pack-1",
            PACK_SCHEMA_VERSION,
            "revision-1",
            900,
            10,
            &payload,
        );
        serde_json::to_value(PackRecord {
            pack_id: "pack-1".to_owned(),
            schema_version: PACK_SCHEMA_VERSION,
            server_revision: "revision-1".to_owned(),
            server_time_ms: 900,
            server_time_offset_ms: 10,
            payload,
            payload_hash: hash,
        })
        .expect("test pack serialization should succeed")
    }

    fn valid_pack_card() -> Value {
        let payload = json!({"question": "Q", "answer": "A"});
        let hash = pack_card_hash("pack-1", "card-1", PACK_SCHEMA_VERSION, 0, 2, &payload);
        serde_json::to_value(PackCardRecord {
            pack_id: "pack-1".to_owned(),
            card_id: "card-1".to_owned(),
            schema_version: PACK_SCHEMA_VERSION,
            ordinal: 0,
            reps: 2,
            answered: false,
            payload,
            payload_hash: hash,
        })
        .expect("test pack-card serialization should succeed")
    }

    fn valid_conflict() -> Value {
        serde_json::to_value(ConflictRecord {
            conflict_id: CONFLICT.to_owned(),
            review_id: REVIEW.to_owned(),
            device_id: DEVICE.to_owned(),
            seq: 1,
            pack_id: "pack-1".to_owned(),
            card_id: "card-1".to_owned(),
            reason: "server rejected review".to_owned(),
            local_review: review_payload(),
            server_response: Some(json!({"error": "conflict"})),
            detected_at_ms: 1_100,
        })
        .expect("test conflict serialization should succeed")
    }

    #[test]
    fn valid_records_pass() {
        let meta = json!({
            "key": "repository",
            "schemaVersion": REPOSITORY_SCHEMA_VERSION,
            "deviceId": DEVICE,
            "nextSeq": 2,
            "ackedThroughSeq": 1
        });
        assert!(validate_meta(&meta).is_ok());
        assert!(validate_pack_record(&valid_pack()).is_ok());
        assert!(validate_pack_card_record(&valid_pack_card()).is_ok());
        assert!(validate_outbox_record(&valid_outbox(), DEVICE).is_ok());
        assert!(validate_conflict_record(&valid_conflict()).is_ok());
    }

    #[test]
    fn missing_field_is_required_field_failure() {
        let mut value = valid_outbox();
        value
            .as_object_mut()
            .expect("test outbox is an object")
            .remove("rating");
        assert_eq!(
            validate_outbox_record(&value, DEVICE)
                .expect_err("missing rating must fail")
                .reason,
            "requiredField"
        );
    }

    #[test]
    fn bad_uuid_is_invalid_id_failure() {
        let mut value = valid_outbox();
        value["reviewId"] = json!("not-a-uuid");
        assert_eq!(
            validate_outbox_record(&value, DEVICE)
                .expect_err("bad review UUID must fail")
                .reason,
            "invalidId"
        );
    }

    #[test]
    fn tampered_payload_is_hash_failure() {
        let mut outbox = valid_outbox();
        outbox["rating"] = json!(2);
        assert_eq!(
            validate_outbox_record(&outbox, DEVICE)
                .expect_err("tampered outbox must fail")
                .reason,
            "payloadHash"
        );

        let mut pack = valid_pack();
        pack["payload"] = json!({"tampered": true});
        assert_eq!(
            validate_pack_record(&pack)
                .expect_err("tampered pack must fail")
                .reason,
            "payloadHash"
        );
    }

    #[test]
    fn unknown_extra_field_is_schema_failure() {
        let mut value = valid_outbox();
        value["extra"] = json!(true);
        assert_eq!(
            validate_outbox_record(&value, DEVICE)
                .expect_err("unknown field must fail")
                .reason,
            "schema"
        );
    }

    #[test]
    fn rating_bounds_are_required_field_failures() {
        for rating in [0, 5] {
            let mut value = valid_outbox();
            value["rating"] = json!(rating);
            assert_eq!(
                validate_outbox_record(&value, DEVICE)
                    .expect_err("out-of-range rating must fail")
                    .reason,
                "requiredField"
            );
        }
    }

    #[test]
    fn zero_sequence_is_required_field_failure() {
        let mut value = valid_outbox();
        value["seq"] = json!(0);
        assert_eq!(
            validate_outbox_record(&value, DEVICE)
                .expect_err("zero sequence must fail")
                .reason,
            "requiredField"
        );
    }

    #[test]
    fn unsafe_integer_is_required_field_failure() {
        let mut value = valid_outbox();
        value["seq"] = json!(MAX_SAFE_INTEGER + 1);
        assert_eq!(
            validate_outbox_record(&value, DEVICE)
                .expect_err("unsafe sequence must fail")
                .reason,
            "requiredField"
        );
    }
}
