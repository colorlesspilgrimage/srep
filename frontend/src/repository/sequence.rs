use super::model::{OutboxRecord, RepositoryError, SequenceGap};

#[derive(Clone, Debug, PartialEq)]
pub struct SequenceSplit {
    pub valid_prefix: Vec<OutboxRecord>,
    pub deferred: Vec<OutboxRecord>,
    pub gaps: Vec<SequenceGap>,
    pub usable: bool,
}

/// Splits validated outbox records into the contiguous upload prefix starting
/// at `acked_through_seq + 1` and ending at `next_seq - 1`, and the deferred
/// tail after the first gap.
///
/// `records` must be pre-sorted by `(device_id, seq)`. Records for another
/// device are sequence violations: they are deferred and produce a gap entry.
/// `usable` is false if and only if at least one gap exists.
pub fn split_outbox_prefix(
    records: Vec<OutboxRecord>,
    device_id: &str,
    acked_through_seq: u64,
    next_seq: u64,
) -> SequenceSplit {
    let mut valid_prefix = Vec::new();
    let mut deferred = Vec::new();
    let mut gaps = Vec::new();
    let mut expected_seq = acked_through_seq.saturating_add(1);
    let mut gap_found = false;

    for record in records {
        if gap_found {
            deferred.push(record);
            continue;
        }

        if record.device_id != device_id {
            gaps.push(SequenceGap {
                device_id: record.device_id.clone(),
                expected_seq,
                found_seq: Some(record.seq),
            });
            deferred.push(record);
            gap_found = true;
            continue;
        }

        if record.seq == expected_seq && expected_seq < next_seq {
            valid_prefix.push(record);
            expected_seq = expected_seq.saturating_add(1);
        } else {
            gaps.push(SequenceGap {
                device_id: device_id.to_owned(),
                expected_seq,
                found_seq: Some(record.seq),
            });
            deferred.push(record);
            gap_found = true;
        }
    }

    if !gap_found && expected_seq < next_seq {
        gaps.push(SequenceGap {
            device_id: device_id.to_owned(),
            expected_seq,
            found_seq: None,
        });
    }

    let usable = gaps.is_empty();
    SequenceSplit {
        valid_prefix,
        deferred,
        gaps,
        usable,
    }
}

/// Validates that `ids` exactly identifies a contiguous prefix of `pending`,
/// in order, without skips, unknown IDs, or duplicates.
pub fn validate_ack_prefix(
    ids: &[String],
    pending: &[OutboxRecord],
) -> Result<u32, RepositoryError> {
    if ids.len() > pending.len() {
        return Err(RepositoryError::AckNotContiguous(
            "ack contains more IDs than the pending outbox".to_owned(),
        ));
    }

    for (index, id) in ids.iter().enumerate() {
        let Some(expected) = pending.get(index) else {
            return Err(RepositoryError::AckNotContiguous(format!(
                "ack ID `{id}` has no pending prefix position"
            )));
        };
        if expected.review_id != *id {
            return Err(RepositoryError::AckNotContiguous(format!(
                "ack ID `{id}` does not match pending review `{}` at prefix position {index}",
                expected.review_id
            )));
        }
    }

    u32::try_from(ids.len()).map_err(|_| {
        RepositoryError::AckNotContiguous("ack prefix length exceeds u32 range".to_owned())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEVICE: &str = "device";

    fn record(review_id: &str, seq: u64) -> OutboxRecord {
        OutboxRecord {
            review_id: review_id.to_owned(),
            device_id: DEVICE.to_owned(),
            seq,
            pack_id: "pack".to_owned(),
            card_id: "card".to_owned(),
            rating: 3,
            expected_reps: 1,
            elapsed_ms: 10,
            client_occurred_at_ms: 100,
            pack_server_time_ms: 90,
            pack_server_time_offset_ms: 0,
            payload_schema_version: 1,
            sending: false,
            payload_hash: "not-used-by-sequence-logic".to_owned(),
        }
    }

    fn records(sequences: &[u64]) -> Vec<OutboxRecord> {
        sequences
            .iter()
            .map(|seq| record(&format!("r{seq}"), *seq))
            .collect()
    }

    fn prefix_sequences(split: &SequenceSplit) -> Vec<u64> {
        split.valid_prefix.iter().map(|record| record.seq).collect()
    }

    fn deferred_sequences(split: &SequenceSplit) -> Vec<u64> {
        split.deferred.iter().map(|record| record.seq).collect()
    }

    #[test]
    fn empty_outbox_has_empty_usable_prefix() {
        let split = split_outbox_prefix(Vec::new(), DEVICE, 0, 1);
        assert!(split.valid_prefix.is_empty());
        assert!(split.deferred.is_empty());
        assert!(split.gaps.is_empty());
        assert!(split.usable);
    }

    #[test]
    fn contiguous_sequence_is_entirely_valid() {
        let split = split_outbox_prefix(records(&[1, 2, 3]), DEVICE, 0, 4);
        assert_eq!(prefix_sequences(&split), vec![1, 2, 3]);
        assert!(split.deferred.is_empty());
        assert!(split.gaps.is_empty());
        assert!(split.usable);
    }

    #[test]
    fn gap_defers_tail() {
        let split = split_outbox_prefix(records(&[1, 3, 4]), DEVICE, 0, 5);
        assert_eq!(prefix_sequences(&split), vec![1]);
        assert_eq!(deferred_sequences(&split), vec![3, 4]);
        assert_eq!(
            split.gaps,
            vec![SequenceGap {
                device_id: DEVICE.to_owned(),
                expected_seq: 2,
                found_seq: Some(3),
            }]
        );
        assert!(!split.usable);
    }

    #[test]
    fn missing_tail_has_no_found_sequence() {
        let split = split_outbox_prefix(records(&[1, 2]), DEVICE, 0, 5);
        assert_eq!(prefix_sequences(&split), vec![1, 2]);
        assert!(split.deferred.is_empty());
        assert_eq!(
            split.gaps,
            vec![SequenceGap {
                device_id: DEVICE.to_owned(),
                expected_seq: 3,
                found_seq: None,
            }]
        );
        assert!(!split.usable);
    }

    #[test]
    fn duplicate_sequence_defers_second_copy_and_tail() {
        let input = vec![record("r1a", 1), record("r1b", 1), record("r2", 2)];
        let split = split_outbox_prefix(input, DEVICE, 0, 3);
        assert_eq!(prefix_sequences(&split), vec![1]);
        assert_eq!(split.deferred.len(), 2);
        assert_eq!(split.deferred[0].review_id, "r1b");
        assert_eq!(split.deferred[1].review_id, "r2");
        assert_eq!(split.gaps.len(), 1);
        assert_eq!(split.gaps[0].expected_seq, 2);
        assert_eq!(split.gaps[0].found_seq, Some(1));
        assert!(!split.usable);
    }

    #[test]
    fn ack_prefix_rules() {
        let pending = records(&[1, 2, 3]);
        assert_eq!(validate_ack_prefix(&[], &pending), Ok(0));
        assert_eq!(validate_ack_prefix(&["r1".to_owned()], &pending), Ok(1));

        assert!(matches!(
            validate_ack_prefix(&["r2".to_owned()], &pending),
            Err(RepositoryError::AckNotContiguous(_))
        ));
        assert!(matches!(
            validate_ack_prefix(&["r1".to_owned(), "r3".to_owned()], &pending),
            Err(RepositoryError::AckNotContiguous(_))
        ));
        assert!(matches!(
            validate_ack_prefix(&["r1".to_owned(), "unknown".to_owned()], &pending),
            Err(RepositoryError::AckNotContiguous(_))
        ));
        assert!(matches!(
            validate_ack_prefix(&["r1".to_owned(), "r1".to_owned()], &pending),
            Err(RepositoryError::AckNotContiguous(_))
        ));
    }
}
