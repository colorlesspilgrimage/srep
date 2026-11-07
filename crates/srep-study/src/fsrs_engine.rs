//! FSRS scheduling wrapper (parity target: `fsrs-adapter.ts`).

use fsrs::FSRS;

/// Shared FSRS parameter set for study scheduling.
pub fn default_scheduler() -> FSRS {
    FSRS::new(None).expect("fsrs defaults")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fsrs_instantiates() {
        let _ = default_scheduler();
    }
}
