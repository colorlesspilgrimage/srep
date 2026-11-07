mod auth;
mod cards;
mod decks;
mod media;
mod note_types;
mod notes;
mod presets;

use axum::Router;
use srep_auth::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(decks::router())
        .merge(presets::router())
        .merge(note_types::router())
        .merge(notes::router())
        .merge(cards::router())
        .merge(media::router())
}
