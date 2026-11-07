use base64::Engine;
use uuid::Uuid;
use webauthn_rs::prelude::{
    AuthenticatorAttachment, AuthenticationResult, Credential, CredentialID, Passkey,
    PasskeyAuthentication, PasskeyRegistration, PublicKeyCredential, RegisterPublicKeyCredential,
    RequestChallengeResponse, SecurityKey, SecurityKeyAuthentication, SecurityKeyRegistration,
    Webauthn,
};

use crate::challenges::{AuthenticationState, RegistrationState};
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

pub fn security_key_from_row(row: &CredentialRow) -> anyhow::Result<SecurityKey> {
    let passkey: Passkey = passkey_from_row(row)?;
    Ok(SecurityKey::from(Credential::from(passkey)))
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
    kind: &str,
    exclude: Vec<CredentialID>,
) -> webauthn_rs::prelude::WebauthnResult<(
    webauthn_rs::prelude::CreationChallengeResponse,
    RegistrationState,
)> {
    let exclude = if exclude.is_empty() {
        None
    } else {
        Some(exclude)
    };
    if kind == "security_key" {
        webauthn
            .start_securitykey_registration(
                user_id,
                "srep",
                "srep owner",
                exclude,
                None,
                Some(AuthenticatorAttachment::CrossPlatform),
            )
            .map(|(ccr, reg)| (ccr, RegistrationState::SecurityKey(reg)))
    } else {
        webauthn
            .start_passkey_registration(user_id, "srep", "srep owner", exclude)
            .map(|(ccr, reg)| (ccr, RegistrationState::Passkey(reg)))
    }
}

pub fn finish_registration(
    webauthn: &Webauthn,
    reg: &RegisterPublicKeyCredential,
    state: &RegistrationState,
) -> webauthn_rs::prelude::WebauthnResult<Passkey> {
    match state {
        RegistrationState::Passkey(s) => webauthn.finish_passkey_registration(reg, s),
        RegistrationState::SecurityKey(s) => webauthn
            .finish_securitykey_registration(reg, s)
            .map(|sk| Passkey::from(Credential::from(sk))),
    }
}

pub fn start_login(
    webauthn: &Webauthn,
    rows: &[CredentialRow],
    kind: &str,
) -> webauthn_rs::prelude::WebauthnResult<(
    RequestChallengeResponse,
    AuthenticationState,
)> {
    if kind == "security_key" {
        let keys: Vec<SecurityKey> = rows
            .iter()
            .filter(|r| r.kind == "security_key")
            .filter_map(|r| security_key_from_row(r).ok())
            .collect();
        webauthn
            .start_securitykey_authentication(&keys)
            .map(|(rcr, st)| (rcr, AuthenticationState::SecurityKey(st)))
    } else {
        let keys: Vec<Passkey> = rows
            .iter()
            .filter_map(|r| passkey_from_row(r).ok())
            .collect();
        webauthn
            .start_passkey_authentication(&keys)
            .map(|(rcr, st)| (rcr, AuthenticationState::Passkey(st)))
    }
}

pub fn finish_login(
    webauthn: &Webauthn,
    resp: &PublicKeyCredential,
    state: &AuthenticationState,
) -> webauthn_rs::prelude::WebauthnResult<AuthenticationResult> {
    match state {
        AuthenticationState::Passkey(s) => webauthn.finish_passkey_authentication(resp, s),
        AuthenticationState::SecurityKey(s) => webauthn.finish_securitykey_authentication(resp, s),
    }
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

fn authenticator_selection(kind: &str) -> serde_json::Value {
    if kind == "passkey" {
        serde_json::json!({
            "authenticatorAttachment": "platform",
            "residentKey": "required",
            "userVerification": "preferred"
        })
    } else {
        serde_json::json!({
            "authenticatorAttachment": "cross-platform",
            "residentKey": "preferred",
            "userVerification": "preferred"
        })
    }
}

/// webauthn-rs wraps credential options in `{ publicKey: … }`; @simplewebauthn/browser expects the inner object.
pub fn creation_options_for_browser(
    ccr: &webauthn_rs::prelude::CreationChallengeResponse,
) -> serde_json::Value {
    creation_options_for_browser_kind(ccr, "passkey")
}

pub fn creation_options_for_browser_kind(
    ccr: &webauthn_rs::prelude::CreationChallengeResponse,
    kind: &str,
) -> serde_json::Value {
    let value = serde_json::to_value(ccr).unwrap_or(serde_json::Value::Null);
    let mut options = value
        .get("publicKey")
        .cloned()
        .unwrap_or(value);
    if let Some(obj) = options.as_object_mut() {
        obj.insert(
            "authenticatorSelection".to_string(),
            authenticator_selection(kind),
        );
        // webauthn-rs adds credential-protection extensions that Chrome rejects in e2e
        // (and some browsers reject in production). Match v1 @simplewebauthn/server output.
        obj.insert(
            "extensions".to_string(),
            serde_json::json!({ "credProps": true }),
        );
    }
    options
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
