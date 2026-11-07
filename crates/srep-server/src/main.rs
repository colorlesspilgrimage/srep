use std::sync::Arc;

use srep_auth::{state::AppState, webauthn::WebAuthnState};
use srep_config::from_env;
use srep_db::{connect, run_migrations};
use srep_server::build_app;
use tokio::net::TcpListener;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,srep_server=debug,srep_auth=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Arc::new(from_env().map_err(|e| anyhow::anyhow!("{e}"))?);
    let pool = connect(&config).await?;
    if config.migrate_on_start {
        run_migrations(&pool, &config).await?;
    }
    let webauthn = Arc::new(WebAuthnState::new(&config.auth)?);
    let state = AppState {
        config: config.clone(),
        db: pool,
        webauthn,
        setup_token: Default::default(),
        limiters: Arc::new(srep_auth::limiters::AuthLimiters::new()),
        simulation_clock: None,
    };
    if let Some(token) = state.ensure_setup_token().await {
        tracing::info!("Setup token (first run): {token}");
    }

    let app = build_app(state);

    let addr = format!("{}:{}", config.host, config.port);
    let listener = TcpListener::bind(&addr).await?;
    tracing::info!(%addr, "srep-server v2 listening");
    axum::serve(listener, app).await?;
    Ok(())
}
