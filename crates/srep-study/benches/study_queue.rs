//! Study queue bench stub (see `docs/perf-v2.md`).

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use srep_study::queue_choice::{choose_next, DeckQuota, DeckSnapshot, NewOrder};

fn bench_choose_next(c: &mut Criterion) {
    let snapshots: Vec<DeckSnapshot> = (0..20)
        .map(|i| DeckSnapshot {
            deck_id: format!("d{i}"),
            new_done: 0,
            review_done: 0,
            learning_due_count: 0,
            learning_today_count: 0,
            learning_head: None,
            next_learning_due: None,
            review_due_count: 5,
            review_head: None,
            new_count: 10,
            new_head: None,
        })
        .collect();
    let quotas: Vec<DeckQuota> = snapshots
        .iter()
        .map(|s| DeckQuota {
            deck_id: s.deck_id.clone(),
            new_per_day: 20,
            reviews_per_day: 200,
            new_order: NewOrder::Added,
        })
        .collect();
    c.bench_function("choose_next_20_decks", |b| {
        b.iter(|| black_box(choose_next(black_box(&snapshots), black_box(&quotas), 1_000_000)))
    });
}

criterion_group!(benches, bench_choose_next);
criterion_main!(benches);
