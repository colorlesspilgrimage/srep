use anyhow::{Context, Result};
use srep_config::AuthConfig;
use url::Url;
use webauthn_rs::{Webauthn, WebauthnBuilder};

pub struct WebAuthnState {
    pub webauthn: Webauthn,
    pub origin: Url,
}

impl WebAuthnState {
    pub fn new(auth: &AuthConfig) -> Result<Self> {
        let origin = Url::parse(&auth.origin).context("invalid SREP_ORIGIN")?;
        let builder = WebauthnBuilder::new(&auth.rp_id, &origin)
            .context("webauthn builder")?
            .rp_name(&auth.rp_name);
        let webauthn = builder.build().context("webauthn build")?;
        Ok(Self { webauthn, origin })
    }
}
