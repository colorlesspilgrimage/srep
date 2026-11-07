# Performance (v2)

Run the Rust server bench (study paths) after R3 ports complete:

```bash
cargo bench -p srep-study
```

Compare against the TypeScript contract:

```bash
npx tsx scripts/perf-bench.ts --decks 20 --notes-per-deck 500 --warmup 5 --runs 30
```

Target SLO (unchanged): SQLite study-next median **≤ 17 ms** at the 20×500 shape.
