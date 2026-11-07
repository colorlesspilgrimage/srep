use anyhow::Result;
use clap::{Parser, Subcommand};
use srep_auth::{routes::reset_auth, state::AppState, webauthn::WebAuthnState};
use srep_config::from_env;
use srep_db::{connect, run_migrations};
use srep_import::backup::{backup_sqlite, restore_sqlite};
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Parser)]
#[command(name = "srep", about = "srep administration CLI (v2)")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Reset WebAuthn credentials and reopen setup (requires host access).
    ResetAuth {
        #[arg(long)]
        yes: bool,
    },
    /// Write a SQLite backup archive.
    Backup {
        #[arg(long)]
        out: PathBuf,
    },
    /// Restore collection tables from a backup archive (SQLite only).
    Restore {
        #[arg(long)]
        from: PathBuf,
        #[arg(long)]
        yes: bool,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();
    let config = Arc::new(from_env()?);
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
    };

    match cli.command {
        Commands::ResetAuth { yes } => {
            if !yes {
                eprintln!("Refusing without --yes");
                std::process::exit(2);
            }
            let token = reset_auth(&state).await?;
            println!("Setup token: {token}");
            println!("Open the setup page to enroll a new credential.");
        }
        Commands::Backup { out } => {
            backup_sqlite(&config, &out).await?;
            println!("Wrote {}", out.display());
        }
        Commands::Restore { from, yes } => {
            if !yes {
                eprintln!("Refusing without --yes");
                std::process::exit(2);
            }
            restore_sqlite(&config, &from).await?;
            println!("Restored from {}", from.display());
        }
    }
    Ok(())
}
