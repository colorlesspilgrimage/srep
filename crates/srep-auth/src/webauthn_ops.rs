use base64::Engine;
use uuid::Uuid;
use webauthn_rs::prelude::{
    AuthenticationResult, CredentialID, Passkey, PublicKeyCredential, RegisterPublicKeyCredential,
    Webauthn,
};

use crate::types::CredentialRow;

pub fn check_sign_count(stored: i64, reported: u32) -> bool {
    if stored == 0 && reported == 0 {
        return true;
    }
    (reported as i64) > stored
}

pub fn credential_id_to_string(id: &CredentialID) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(id.as_ref())
}

pub fn credential_id_from_string(s: &str) -> Option<CredentialID> {
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(s)
        .ok()?;
    Some(CredentialID::from(bytes))
}

pub fn passkey_from_row(row: &CredentialRow) -> anyhow::Result<Passkey> {
    serde_json::from_str(&row.public_key).map_err(Into::into)
}

pub fn row_from_passkey(
    passkey: &Passkey,
    kind: &str,
    nickname: &str,
    created_at: i64,
    transports: Vec<String>,
) -> CredentialRow {
    let credential_id = credential_id_to_string(passkey.cred_id());
    let public_key = serde_json::to_string(passkey).unwrap_or_default();
    CredentialRow {
        id: Uuid::new_v4(),
        credential_id,
        public_key,
        sign_count: 0,
        transports,
        kind: kind.to_string(),
        nickname: nickname.to_string(),
        created_at,
        last_used_at: None,
    }
}

pub fn sanitize_transports(transports: Option<Vec<String>>) -> Vec<String> {
    const ALLOWED: &[&str] = &[
        "usb",
        "nfc",
        "ble",
        "internal",
        "hybrid",
        "smart-card",
        "cable",
    ];
    let Some(list) = transports else {
        return vec![];
    };
    let mut out: Vec<String> = list
        .into_iter()
        .filter(|t| ALLOWED.contains(&t.as_str()))
        .collect();
    out.sort();
    out.dedup();
    out
}

pub fn transports_from_registration(reg: &RegisterPublicKeyCredential) -> Vec<String> {
    let list = reg.response.transports.as_ref().map(|items| {
        items
            .iter()
            .map(|t| format!("{t:?}").trim_matches('"').to_lowercase())
            .collect::<Vec<_>>()
    });
    sanitize_transports(list)
}

pub fn start_registration(
    webauthn: &Webauthn,
    user_id: Uuid,
    _kind: &str,
    exclude: Vec<CredentialID>,
) -> webauthn_rs::prelude::WebauthnResult<(
    webauthn_rs::prelude::CreationChallengeResponse,
    webauthn_rs::prelude::PasskeyRegistration,
)> {
    let exclude = if exclude.is_empty() {
        None
    } else {
        Some(exclude)
    };
    webauthn.start_passkey_registration(user_id, "srep", "srep owner", exclude)
}

pub fn finish_registration(
    webauthn: &Webauthn,
    reg: &RegisterPublicKeyCredential,
    state: &webauthn_rs::prelude::PasskeyRegistration,
) -> webauthn_rs::prelude::WebauthnResult<Passkey> {
    webauthn.finish_passkey_registration(reg, state)
}

pub fn start_login(
    webauthn: &Webauthn,
    keys: &[Passkey],
    _kind: &str,
) -> webauthn_rs::prelude::WebauthnResult<(
    webauthn_rs::prelude::RequestChallengeResponse,
    webauthn_rs::prelude::PasskeyAuthentication,
)> {
    webauthn.start_passkey_authentication(keys)
}

pub fn finish_login(
    webauthn: &Webauthn,
    resp: &PublicKeyCredential,
    state: &webauthn_rs::prelude::PasskeyAuthentication,
) -> webauthn_rs::prelude::WebauthnResult<AuthenticationResult> {
    webauthn.finish_passkey_authentication(resp, state)
}

fn challenge_from_options_value(value: &serde_json::Value) -> String {
    value
        .get("challenge")
        .and_then(|c| c.as_str())
        .map(String::from)
        .or_else(|| {
            value
                .get("publicKey")
                .and_then(|pk| pk.get("challenge"))
                .and_then(|c| c.as_str())
                .map(String::from)
        })
        .unwrap_or_default()
}

/// webauthn-rs wraps credential options in `{ publicKey: … }`; @simplewebauthn/browser expects the inner object.
pub fn creation_options_for_browser(
    ccr: &webauthn_rs::prelude::CreationChallengeResponse,
) -> serde_json::Value {
    let value = serde_json::to_value(ccr).unwrap_or(serde_json::Value::Null);
    value
        .get("publicKey")
        .cloned()
        .unwrap_or(value)
}

pub fn request_options_for_browser(
    rcr: &webauthn_rs::prelude::RequestChallengeResponse,
) -> serde_json::Value {
    let value = serde_json::to_value(rcr).unwrap_or(serde_json::Value::Null);
    value
        .get("publicKey")
        .cloned()
        .unwrap_or(value)
}

pub fn challenge_string_from_creation(
    ccr: &webauthn_rs::prelude::CreationChallengeResponse,
) -> String {
    serde_json::to_value(ccr)
        .ok()
        .map(|v| challenge_from_options_value(&v))
        .unwrap_or_default()
}

pub fn challenge_string_from_request(
    rcr: &webauthn_rs::prelude::RequestChallengeResponse,
) -> String {
    serde_json::to_value(rcr)
        .ok()
        .map(|v| challenge_from_options_value(&v))
        .unwrap_or_default()
}
