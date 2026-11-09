use super::model::ReviewPayload;
use serde_json::Value;
use sha2::{Digest, Sha256};

pub fn sha256_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";

    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest.iter() {
        output.push(HEX[usize::from(byte >> 4)] as char);
        output.push(HEX[usize::from(byte & 0x0f)] as char);
    }
    output
}

/// Produces compact JSON with every object's keys recursively sorted
/// lexicographically. Array order and JSON number representations are retained.
pub fn canonical_json(value: &Value) -> String {
    let mut output = String::new();
    write_canonical_json(value, &mut output);
    output
}

fn write_canonical_json(value: &Value, output: &mut String) {
    match value {
        Value::Null => output.push_str("null"),
        Value::Bool(true) => output.push_str("true"),
        Value::Bool(false) => output.push_str("false"),
        Value::Number(number) => output.push_str(&number.to_string()),
        Value::String(string) => write_json_string(string, output),
        Value::Array(values) => {
            output.push('[');
            for (index, value) in values.iter().enumerate() {
                if index != 0 {
                    output.push(',');
                }
                write_canonical_json(value, output);
            }
            output.push(']');
        }
        Value::Object(object) => {
            let mut entries: Vec<_> = object.iter().collect();
            entries.sort_by(|left, right| left.0.cmp(right.0));

            output.push('{');
            for (index, (key, value)) in entries.into_iter().enumerate() {
                if index != 0 {
                    output.push(',');
                }
                write_json_string(key, output);
                output.push(':');
                write_canonical_json(value, output);
            }
            output.push('}');
        }
    }
}

fn write_json_string(value: &str, output: &mut String) {
    output.push_str(
        &serde_json::to_string(value)
            .expect("serializing an in-memory Rust string as JSON cannot fail"),
    );
}

/// Hashes the canonical JSON representation of the semantic review payload.
///
/// Canonical rule for every repository hash: the hash input is always
/// `canonical_json` of the value produced by serializing the fixed field set.
/// Consequently, canonical key sorting wins over struct or macro insertion
/// order. Changing declaration order does not change a hash; changing the field
/// set or any field value does. Nested payloads use this same canonical rule.
pub fn review_payload_hash(payload: &ReviewPayload) -> String {
    let value = serde_json::to_value(payload)
        .expect("serializing a ReviewPayload containing only primitive fields cannot fail");
    sha256_hex(canonical_json(&value).as_bytes())
}

pub fn pack_hash(
    pack_id: &str,
    schema_version: u32,
    server_revision: &str,
    server_time_ms: i64,
    server_time_offset_ms: i64,
    payload: &Value,
) -> String {
    let value = serde_json::json!({
        "packId": pack_id,
        "schemaVersion": schema_version,
        "serverRevision": server_revision,
        "serverTimeMs": server_time_ms,
        "serverTimeOffsetMs": server_time_offset_ms,
        "payload": payload,
    });
    sha256_hex(canonical_json(&value).as_bytes())
}

pub fn pack_card_hash(
    pack_id: &str,
    card_id: &str,
    schema_version: u32,
    ordinal: u32,
    reps: u32,
    payload: &Value,
) -> String {
    let value = serde_json::json!({
        "packId": pack_id,
        "cardId": card_id,
        "schemaVersion": schema_version,
        "ordinal": ordinal,
        "reps": reps,
        "payload": payload,
    });
    sha256_hex(canonical_json(&value).as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload() -> ReviewPayload {
        ReviewPayload {
            review_id: "review-1".to_owned(),
            device_id: "device-1".to_owned(),
            seq: 7,
            pack_id: "pack-1".to_owned(),
            card_id: "card-1".to_owned(),
            rating: 3,
            expected_reps: 2,
            elapsed_ms: 1_250,
            client_occurred_at_ms: 1_700_000_000_000,
            pack_server_time_ms: 1_699_999_999_000,
            pack_server_time_offset_ms: 25,
            payload_schema_version: 1,
        }
    }

    #[test]
    fn sha256_matches_golden_vector() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn sending_does_not_change_review_hash() {
        let payload = payload();
        let expected = review_payload_hash(&payload);
        let first = payload
            .clone()
            .into_outbox(false, "first-stored-hash".to_owned());
        let second = payload.into_outbox(true, "second-stored-hash".to_owned());

        assert_eq!(review_payload_hash(&first.payload()), expected);
        assert_eq!(review_payload_hash(&second.payload()), expected);
    }

    #[test]
    fn different_field_values_change_review_hash() {
        let first = payload();
        let mut second = first.clone();
        second.rating = 4;

        assert_ne!(review_payload_hash(&first), review_payload_hash(&second));
    }

    #[test]
    fn nested_object_key_order_does_not_change_hash() {
        let first = serde_json::json!({"b": 1, "a": 2, "nested": {"z": 3, "y": 4}});
        let second = serde_json::json!({"a": 2, "nested": {"y": 4, "z": 3}, "b": 1});

        assert_eq!(
            pack_hash("pack", 1, "revision", 10, 20, &first),
            pack_hash("pack", 1, "revision", 10, 20, &second)
        );
        assert_eq!(
            pack_card_hash("pack", "card", 1, 2, 3, &first),
            pack_card_hash("pack", "card", 1, 2, 3, &second)
        );
    }
}
