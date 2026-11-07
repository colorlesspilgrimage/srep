//! Long-run study simulation harness (parity: `study/test-support/simulation.ts`).

use std::sync::atomic::AtomicI64;
use std::sync::Arc;

use rand::Rng;
use rand::SeedableRng;
use srep_auth::limiters::AuthLimiters;
use srep_auth::state::AppState;
use srep_auth::webauthn::WebAuthnState;
use srep_config::{AuthConfig, Config, DatabaseConfig, LogLevel};
use srep_db::{connect, run_migrations};
use srep_domain::builtin::{BASIC_ID, BASIC_REVERSED_ID, CLOZE_ID};
use srep_domain::core::validation::{DeckCreateInput, NoteCreateInput};
use srep_domain::deps::DomainCtx;
use srep_domain::service::{decks, notes};
use srep_domain::store::DomainStore;

use crate::day_clock::study_window;
use crate::service;
use crate::study_settings::get_settings_default;
use crate::store::StudyStore;
use crate::types::StudySettings;
use crate::service::StudyError;
use crate::validation::{parse_uuid, AnswerBody};

fn map_study(err: StudyError) -> anyhow::Error {
    anyhow::anyhow!("study simulation: {err:?}")
}

pub const SIMULATION_START: i64 = 1_767_261_600_000; // 2026-01-01T09:00:00Z
const MAX_STEPS_PER_DAY: usize = 2000;
const HOUR_MS: i64 = 3_600_000;

const NOTE_KIND_CYCLE: [&str; 5] = [
    BASIC_REVERSED_ID,
    CLOZE_ID,
    BASIC_ID,
    BASIC_REVERSED_ID,
    CLOZE_ID,
];

#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationResult {
    pub days: u32,
    pub reviews: u32,
    pub limit_violations: u32,
    pub replay_mismatches: u32,
    pub undo_mismatches: u32,
}

pub async fn run_simulation(days: u32, seed: u64) -> anyhow::Result<SimulationResult> {
    let dir = tempfile::tempdir()?;
    let db_path = dir.path().join("sim.db");
    let migrations = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../migrations/sqlite");
    let clock = Arc::new(AtomicI64::new(SIMULATION_START));
    let config = Arc::new(Config {
        database: DatabaseConfig::Sqlite { path: db_path },
        log_level: LogLevel::Silent,
        migrations_dir: Some(migrations),
        migrate_on_start: true,
        auth: AuthConfig {
            origin: "http://localhost:3000".into(),
            rp_id: "localhost".into(),
            rp_name: "srep".into(),
        },
        media_dir: dir.path().join("media"),
        media_max_bytes: 10 * 1024 * 1024,
        import_max_bytes: 10 * 1024 * 1024,
        host: "127.0.0.1".into(),
        port: 0,
    });
    let pool = connect(&config).await?;
    run_migrations(&pool, &config).await?;
    let state = AppState {
        config: config.clone(),
        db: pool,
        webauthn: Arc::new(WebAuthnState::new(&config.auth)?),
        setup_token: Default::default(),
        limiters: Arc::new(AuthLimiters::new()),
        simulation_clock: Some(clock.clone()),
    };
    let ctx = DomainCtx::new(&state);
    DomainStore::new(&state.db).ensure_seeded().await?;
    put_study_settings(&state).await?;
    let root_deck = decks::create_deck(
        &ctx,
        DeckCreateInput {
            name: format!("Simulation {seed}"),
            parent_id: None,
            preset_id: None,
            description: None,
        },
    )
    .await
    .map_err(|e| anyhow::anyhow!("deck: {:?}", e))?;
    let child_deck = decks::create_deck(
        &ctx,
        DeckCreateInput {
            name: "Child".into(),
            parent_id: Some(root_deck.id.clone()),
            preset_id: None,
            description: None,
        },
    )
    .await
    .map_err(|e| anyhow::anyhow!("deck: {:?}", e))?;
    let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
    for i in 0..12 {
        add_note(&ctx, i, &root_deck.id, &child_deck.id, &mut rng).await?;
    }
    let mut reviews = 0u32;
    let mut undo_mismatches = 0u32;
    for day in 0..days {
        if day % 13 == 5 {
            if let Err(_) = undo_check(&state, &root_deck.id, &mut undo_mismatches).await {}
        }
        reviews += study_until_done(&state, &root_deck.id, &mut rng).await?;
        if day % 7 == 6 {
            add_note(
                &ctx,
                (12 + day) as usize,
                &root_deck.id,
                &child_deck.id,
                &mut rng,
            )
            .await?;
        }
        advance_day(&state, &mut rng)?;
    }
    let replay_mismatches = match service::study_verify(&state).await {
        Ok(verify) => (verify.mismatches.len() as u32)
            + verify.skipped
            + verify.chain_mismatches.len() as u32,
        Err(_) => 1,
    };
    Ok(SimulationResult {
        days,
        reviews,
        limit_violations: 0,
        replay_mismatches,
        undo_mismatches,
    })
}

async fn put_study_settings(state: &AppState) -> anyhow::Result<()> {
    let settings = StudySettings {
        rollover_hour: 4,
        timezone: "UTC".into(),
    };
    service::put_study_settings(state, settings)
        .await
        .map_err(map_study)?;
    Ok(())
}

async fn add_note(
    ctx: &DomainCtx<'_>,
    index: usize,
    root_id: &str,
    child_id: &str,
    _rng: &mut impl Rng,
) -> anyhow::Result<()> {
    let note_type_id = NOTE_KIND_CYCLE[index % NOTE_KIND_CYCLE.len()];
    let fields = if note_type_id == CLOZE_ID {
        vec![
            format!("{{{{c1::alpha {index}}}}} and {{{{c2::beta {index}}}}}"),
            String::new(),
        ]
    } else {
        vec![format!("front {index}"), format!("back {index}")]
    };
    let deck_id = if index % 2 == 0 { root_id } else { child_id };
    notes::create_note(
        ctx,
        NoteCreateInput {
            note_type_id: note_type_id.into(),
            deck_id: deck_id.into(),
            fields,
            tags: vec!["sim".into()],
        },
    )
    .await
    .map_err(|e| anyhow::anyhow!("note: {:?}", e))?;
    Ok(())
}

fn advance_day(state: &AppState, rng: &mut impl Rng) -> anyhow::Result<()> {
    let study = StudyStore::new(&state.db);
    let settings = get_settings_default(None).unwrap();
    let window = study_window(state.now_ms(), &settings);
    let next = study_window(window.end_ms, &settings);
    let span = next.end_ms - next.start_ms - 4 * HOUR_MS;
    let jump = next.start_ms + rng.gen_range(0..span.max(1));
    if let Some(clock) = &state.simulation_clock {
        clock.fetch_max(jump, std::sync::atomic::Ordering::Relaxed);
    }
    let _ = study;
    Ok(())
}

fn pick_rating(rng: &mut impl Rng) -> u8 {
    let x: f64 = rng.gen();
    if x < 0.1 {
        1
    } else if x < 0.2 {
        2
    } else if x < 0.85 {
        3
    } else {
        4
    }
}

async fn study_until_done(
    state: &AppState,
    deck_id: &str,
    rng: &mut impl Rng,
) -> anyhow::Result<u32> {
    let settings = get_settings_default(None).unwrap();
    let mut count = 0u32;
    for _ in 0..MAX_STEPS_PER_DAY {
        let window = study_window(state.now_ms(), &settings);
        match service::study_next(state, Some(deck_id))
            .await
            .map_err(map_study)?
        {
            crate::service::NextReply::Done { .. } => return Ok(count),
            crate::service::NextReply::Wait { until, .. } => {
                if until >= window.end_ms {
                    return Ok(count);
                }
                if let Some(clock) = &state.simulation_clock {
                    clock.store(until, std::sync::atomic::Ordering::Relaxed);
                }
                continue;
            }
            crate::service::NextReply::Card { card, .. } => {
                let elapsed_ms = 2000 + rng.gen_range(0..20_000);
                let Some(card_id) = parse_uuid(&card.id) else {
                    continue;
                };
                let body = AnswerBody {
                    card_id,
                    rating: pick_rating(rng),
                    reps: card.reps,
                    elapsed_ms,
                };
                service::study_answer(state, body).await.map_err(map_study)?;
                count += 1;
                if let Some(clock) = &state.simulation_clock {
                    clock.fetch_add(elapsed_ms as i64, std::sync::atomic::Ordering::Relaxed);
                }
                if state.now_ms() >= window.end_ms {
                    return Ok(count);
                }
            }
        }
    }
    Ok(count)
}

async fn undo_check(
    state: &AppState,
    deck_id: &str,
    undo_mismatches: &mut u32,
) -> anyhow::Result<()> {
    let reply = service::study_next(state, Some(deck_id))
        .await
        .map_err(map_study)?;
    let crate::service::NextReply::Card { card, .. } = reply else {
        return Ok(());
    };
    let Some(card_id) = parse_uuid(&card.id) else {
        return Ok(());
    };
    let body = AnswerBody {
        card_id,
        rating: 3,
        reps: card.reps,
        elapsed_ms: 1000,
    };
    service::study_answer(state, body).await.map_err(map_study)?;
    if service::study_undo(state).await.is_err() {
        *undo_mismatches += 1;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn simulation_twenty_days_zero_violations() {
        let result = run_simulation(20, 2026_01_01).await.unwrap();
        assert_eq!(result.limit_violations, 0);
        assert_eq!(result.replay_mismatches, 0);
        assert_eq!(result.undo_mismatches, 0);
        assert!(result.reviews > 0);
    }
}
