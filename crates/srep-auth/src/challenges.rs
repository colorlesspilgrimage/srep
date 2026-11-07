use serde::{Deserialize, Serialize};
use webauthn_rs::prelude::{
    PasskeyAuthentication, PasskeyRegistration, SecurityKeyAuthentication, SecurityKeyRegistration,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "reg_kind", content = "reg")]
pub enum RegistrationState {
    #[serde(rename = "passkey")]
    Passkey(PasskeyRegistration),
    #[serde(rename = "security_key")]
    SecurityKey(SecurityKeyRegistration),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "auth_kind", content = "auth")]
pub enum AuthenticationState {
    #[serde(rename = "passkey")]
    Passkey(PasskeyAuthentication),
    #[serde(rename = "security_key")]
    SecurityKey(SecurityKeyAuthentication),
}

use crate::session::now_ms;
use crate::store::AuthStore;
use crate::tokens::random_token;
use crate::types::{ChallengePurpose, CHALLENGE_TTL_MS};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredChallenge {
    pub challenge: String,
    #[serde(flatten)]
    pub state: ChallengeState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "purpose", content = "state")]
pub enum ChallengeState {
    #[serde(rename = "setup")]
    Setup(RegistrationState),
    #[serde(rename = "register")]
    Register(RegistrationState),
    #[serde(rename = "login")]
    Login(AuthenticationState),
}

pub async fn create_challenge(
    store: &AuthStore<'_>,
    purpose: ChallengePurpose,
    challenge: &str,
    state: ChallengeState,
) -> anyhow::Result<String> {
    let now = now_ms();
    store.prune_challenges(now).await?;
    let id = random_token(16);
    let expires = now + CHALLENGE_TTL_MS;
    let payload = StoredChallenge {
        challenge: challenge.to_string(),
        state,
    };
    let encoded = serde_json::to_string(&payload)?;
    store
        .insert_challenge(&id, &encoded, purpose, expires)
        .await?;
    Ok(id)
}

pub enum TakeChallengeError {
    Invalid,
    Expired,
}

pub async fn take_challenge(
    store: &AuthStore<'_>,
    id: &str,
    purpose: ChallengePurpose,
) -> Result<StoredChallenge, TakeChallengeError> {
    let row = store
        .consume_challenge(id)
        .await
        .map_err(|_| TakeChallengeError::Invalid)?;
    let Some(row) = row else {
        return Err(TakeChallengeError::Invalid);
    };
    if row.purpose != purpose {
        return Err(TakeChallengeError::Invalid);
    }
    if now_ms() >= row.expires_at {
        return Err(TakeChallengeError::Expired);
    }
    serde_json::from_str(&row.challenge).map_err(|_| TakeChallengeError::Invalid)
}
