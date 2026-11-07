use serde::Serialize;
use uuid::Uuid;

pub type CredentialKind = String; // "passkey" | "security_key"

#[derive(Debug, Clone)]
pub struct CredentialRow {
    pub id: Uuid,
    pub credential_id: String,
    pub public_key: String,
    pub sign_count: i64,
    pub transports: Vec<String>,
    pub kind: String,
    pub nickname: String,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicCredential {
    pub id: String,
    pub nickname: String,
    pub kind: String,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
    pub transports: Vec<String>,
}

impl From<CredentialRow> for PublicCredential {
    fn from(row: CredentialRow) -> Self {
        Self {
            id: row.id.to_string(),
            nickname: row.nickname,
            kind: row.kind,
            created_at: row.created_at,
            last_used_at: row.last_used_at,
            transports: row.transports,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChallengePurpose {
    Setup,
    Register,
    Login,
}

impl ChallengePurpose {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Setup => "setup",
            Self::Register => "register",
            Self::Login => "login",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "setup" => Some(Self::Setup),
            "register" => Some(Self::Register),
            "login" => Some(Self::Login),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ChallengeRow {
    pub id: String,
    pub challenge: String,
    pub purpose: ChallengePurpose,
    pub expires_at: i64,
}

#[derive(Debug, Clone)]
pub struct RecoveryRow {
    pub id: Uuid,
    pub code_hash: String,
}

#[derive(Debug, Clone)]
pub struct ApiTokenRow {
    pub id: Uuid,
    pub token_hash: String,
    pub name: String,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
    pub revoked_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiTokenView {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
    pub revoked_at: Option<i64>,
}

impl From<ApiTokenRow> for ApiTokenView {
    fn from(row: ApiTokenRow) -> Self {
        Self {
            id: row.id.to_string(),
            name: row.name,
            created_at: row.created_at,
            last_used_at: row.last_used_at,
            revoked_at: row.revoked_at,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PairingCodeRow {
    pub id: Uuid,
    pub code_hash: String,
    pub name: String,
    pub created_at: i64,
    pub expires_at: i64,
    pub consumed_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct CompleteSetupInput {
    pub credential: CredentialRow,
    pub recovery_hashes: Vec<RecoveryRow>,
    pub session: crate::session::SessionRow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeleteCredentialResult {
    Deleted,
    NotFound,
    LastCredential,
}

pub const CHALLENGE_TTL_MS: i64 = 5 * 60 * 1000;
