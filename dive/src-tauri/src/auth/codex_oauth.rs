//! Codex OAuth (PKCE) — ChatGPT subscription provider. Spec §7.4.
//!
//! Implements the Authorization Code + PKCE flow against
//! `https://auth.openai.com/oauth`. Client secret is not required because
//! PKCE is a public-client extension (RFC 7636). Tokens are issued by the
//! token endpoint after the user approves the consent screen. The access
//! token is used against the OpenAI Responses API with the additional
//! `ChatGPT-Account-ID` header extracted from the `id_token` JWT claims.
//!
//! This module is deliberately I/O-centric and keeps zero state — the
//! caller threads `PkcePair`, the CSRF `state`, and the received `code`
//! through ordinary arguments. Persistence of `access_token` /
//! `refresh_token` / `id_token` is the responsibility of the caller via
//! `SecretScope::Codex*Token` keyring entries. This keeps the unit surface
//! small enough to cover deterministically with `wiremock`.
//!
//! The upstream endpoints are fixed per the Codex CLI reference; tests
//! override `base_auth_url` to point at a local mock server.
//!
//! # Pieces
//!
//! * [`PkcePair`] — SHA-256 code_verifier + code_challenge generator.
//! * [`CodexOAuth`] — HTTP wrapper around `authorize` URL construction,
//!   `/token` exchange, and refresh.
//! * [`CodexTokens`] — owned payload returned from `/token`, ready for
//!   keyring persistence; `account_id` is decoded from `id_token`
//!   claims without external JWT libraries (we accept *unverified*
//!   claims — signature verification is OpenAI's job, not ours, since
//!   the tokens travel over HTTPS to a fixed hostname).

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const DEFAULT_AUTH_BASE_URL: &str = "https://auth.openai.com";
pub const DEFAULT_REDIRECT_URI: &str = "http://localhost:1455/callback";
pub const DEFAULT_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
pub const DEFAULT_SCOPE: &str = "openid email profile offline_access";

#[derive(Debug, Error)]
pub enum OAuthError {
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("remote {status}: {body}")]
    Remote { status: u16, body: String },
    #[error("decode: {0}")]
    Decode(String),
    #[error("state mismatch: csrf tokens differ")]
    StateMismatch,
}

/// PKCE verifier/challenge pair — S256 method.
#[derive(Debug, Clone)]
pub struct PkcePair {
    pub verifier: String,
    pub challenge: String,
}

impl PkcePair {
    /// Generate a fresh 32-byte verifier and its SHA-256 challenge.
    pub fn generate() -> Self {
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        Self::from_verifier_bytes(&bytes)
    }

    /// Deterministic helper for tests.
    pub fn from_verifier_bytes(bytes: &[u8]) -> Self {
        let verifier = URL_SAFE_NO_PAD.encode(bytes);
        let digest = Sha256::digest(verifier.as_bytes());
        let challenge = URL_SAFE_NO_PAD.encode(digest);
        Self {
            verifier,
            challenge,
        }
    }
}

/// A 32-byte CSRF `state` value encoded base64url.
pub fn random_state() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Tokens returned by the `/oauth/token` endpoint plus the decoded
/// ChatGPT account_id needed for the `ChatGPT-Account-ID` header.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CodexTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub id_token: String,
    pub account_id: String,
    pub expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
}

pub struct CodexOAuth {
    base_auth_url: String,
    client_id: String,
    redirect_uri: String,
    scope: String,
    http: reqwest::Client,
}

impl CodexOAuth {
    pub fn new() -> Self {
        Self::with_base_url(DEFAULT_AUTH_BASE_URL)
    }

    pub fn with_base_url(base_auth_url: impl Into<String>) -> Self {
        Self {
            base_auth_url: base_auth_url.into().trim_end_matches('/').to_string(),
            client_id: DEFAULT_CLIENT_ID.to_string(),
            redirect_uri: DEFAULT_REDIRECT_URI.to_string(),
            scope: DEFAULT_SCOPE.to_string(),
            http: reqwest::Client::new(),
        }
    }

    pub fn with_client_id(mut self, client_id: impl Into<String>) -> Self {
        self.client_id = client_id.into();
        self
    }

    pub fn with_redirect_uri(mut self, redirect_uri: impl Into<String>) -> Self {
        self.redirect_uri = redirect_uri.into();
        self
    }

    pub fn redirect_uri(&self) -> &str {
        &self.redirect_uri
    }

    pub fn client_id(&self) -> &str {
        &self.client_id
    }

    /// Build the authorization URL the user must open in the browser.
    pub fn authorization_url(&self, pkce: &PkcePair, state: &str) -> String {
        let params = [
            ("response_type", "code"),
            ("client_id", self.client_id.as_str()),
            ("redirect_uri", self.redirect_uri.as_str()),
            ("scope", self.scope.as_str()),
            ("code_challenge", pkce.challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("state", state),
        ];
        let query = params
            .iter()
            .map(|(k, v)| format!("{}={}", k, urlencode(v)))
            .collect::<Vec<_>>()
            .join("&");
        format!("{}/oauth/authorize?{query}", self.base_auth_url)
    }

    /// Exchange an authorization `code` for tokens.
    pub async fn exchange_code(
        &self,
        code: &str,
        pkce_verifier: &str,
    ) -> Result<CodexTokens, OAuthError> {
        #[derive(Serialize)]
        struct Req<'a> {
            grant_type: &'a str,
            code: &'a str,
            redirect_uri: &'a str,
            client_id: &'a str,
            code_verifier: &'a str,
        }
        let req = Req {
            grant_type: "authorization_code",
            code,
            redirect_uri: &self.redirect_uri,
            client_id: &self.client_id,
            code_verifier: pkce_verifier,
        };
        self.post_token(&req).await
    }

    /// Refresh an access_token using a stored refresh_token.
    pub async fn refresh(&self, refresh_token: &str) -> Result<CodexTokens, OAuthError> {
        #[derive(Serialize)]
        struct Req<'a> {
            grant_type: &'a str,
            refresh_token: &'a str,
            client_id: &'a str,
            scope: &'a str,
        }
        let req = Req {
            grant_type: "refresh_token",
            refresh_token,
            client_id: &self.client_id,
            scope: &self.scope,
        };
        self.post_token(&req).await
    }

    async fn post_token<T: Serialize>(&self, req: &T) -> Result<CodexTokens, OAuthError> {
        let url = format!("{}/oauth/token", self.base_auth_url);
        let resp = self.http.post(&url).json(req).send().await?;
        let status = resp.status();
        if !status.is_success() {
            return Err(OAuthError::Remote {
                status: status.as_u16(),
                body: resp.text().await.unwrap_or_default(),
            });
        }
        let body: TokenResponse = resp.json().await?;
        let id_token = body
            .id_token
            .ok_or_else(|| OAuthError::Decode("missing id_token".into()))?;
        let refresh_token = body
            .refresh_token
            .ok_or_else(|| OAuthError::Decode("missing refresh_token".into()))?;
        let account_id = decode_account_id(&id_token)?;
        Ok(CodexTokens {
            access_token: body.access_token,
            refresh_token,
            id_token,
            account_id,
            expires_in: body.expires_in.unwrap_or(3600),
        })
    }
}

impl Default for CodexOAuth {
    fn default() -> Self {
        Self::new()
    }
}

/// Extract `account_id` (or `chatgpt_account_id`) from a JWT id_token's
/// middle segment. We do **not** verify the signature: the tokens were
/// just received over TLS from the fixed hostname, and the claim is only
/// used as a routing header. The upstream API re-validates everything.
pub fn decode_account_id(id_token: &str) -> Result<String, OAuthError> {
    let mut parts = id_token.splitn(3, '.');
    let _header = parts
        .next()
        .ok_or_else(|| OAuthError::Decode("id_token missing header".into()))?;
    let payload = parts
        .next()
        .ok_or_else(|| OAuthError::Decode("id_token missing payload".into()))?;
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|e| OAuthError::Decode(format!("base64url: {e}")))?;
    let claims: serde_json::Value =
        serde_json::from_slice(&decoded).map_err(|e| OAuthError::Decode(format!("json: {e}")))?;
    // Search the Codex-style nested claim first, then fallbacks.
    if let Some(id) = claims
        .get("https://api.openai.com/auth")
        .and_then(|v| v.get("chatgpt_account_id"))
        .and_then(|v| v.as_str())
    {
        return Ok(id.to_string());
    }
    for key in [
        "chatgpt_account_id",
        "account_id",
        "https://openai.com/chatgpt_account_id",
    ] {
        if let Some(id) = claims.get(key).and_then(|v| v.as_str()) {
            return Ok(id.to_string());
        }
    }
    Err(OAuthError::Decode(
        "id_token: no chatgpt_account_id claim".into(),
    ))
}

/// Minimal application/x-www-form-urlencoded encoder for the fixed
/// character set we use in authorization URLs. Keeps dependencies small.
fn urlencode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for b in input.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push('%');
                out.push_str(&format!("{:02X}", b));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn encode_id_token(account_id: &str) -> String {
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none"}"#);
        let payload_json = serde_json::json!({
            "https://api.openai.com/auth": {
                "chatgpt_account_id": account_id,
            },
            "sub": "user_123",
            "email": "teacher@example.com",
        });
        let payload = URL_SAFE_NO_PAD.encode(payload_json.to_string());
        let signature = URL_SAFE_NO_PAD.encode("sig");
        format!("{header}.{payload}.{signature}")
    }

    #[test]
    fn pkce_pair_is_deterministic_from_bytes() {
        let pair = PkcePair::from_verifier_bytes(&[0u8; 32]);
        // 32 zero bytes → 43-char URL-safe verifier.
        assert_eq!(pair.verifier.len(), 43);
        // Challenge must also be 43 chars (SHA-256 → 32 bytes → 43 b64url).
        assert_eq!(pair.challenge.len(), 43);
        // Challenge is the b64url of SHA-256(verifier).
        let recomputed = URL_SAFE_NO_PAD.encode(Sha256::digest(pair.verifier.as_bytes()));
        assert_eq!(recomputed, pair.challenge);
    }

    #[test]
    fn pkce_generate_produces_unique_pairs() {
        let a = PkcePair::generate();
        let b = PkcePair::generate();
        assert_ne!(a.verifier, b.verifier);
        assert_ne!(a.challenge, b.challenge);
    }

    #[test]
    fn random_state_is_unique() {
        let a = random_state();
        let b = random_state();
        assert_ne!(a, b);
        assert!(a.len() >= 40);
    }

    #[test]
    fn authorization_url_contains_all_pkce_params() {
        let oauth = CodexOAuth::with_base_url("https://auth.example.com")
            .with_client_id("test-client")
            .with_redirect_uri("http://localhost:1455/callback");
        let pkce = PkcePair::from_verifier_bytes(&[1u8; 32]);
        let url = oauth.authorization_url(&pkce, "csrf-123");
        assert!(url.starts_with("https://auth.example.com/oauth/authorize?"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("client_id=test-client"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains(&format!("code_challenge={}", pkce.challenge)));
        assert!(url.contains("state=csrf-123"));
        // Redirect URI must be URL-encoded.
        assert!(url.contains("redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fcallback"));
    }

    #[test]
    fn decode_account_id_reads_namespaced_claim() {
        let token = encode_id_token("acct_abc123");
        assert_eq!(decode_account_id(&token).unwrap(), "acct_abc123");
    }

    #[test]
    fn decode_account_id_fails_without_claim() {
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none"}"#);
        let payload = URL_SAFE_NO_PAD.encode(r#"{"sub":"user_1"}"#);
        let sig = URL_SAFE_NO_PAD.encode("sig");
        let token = format!("{header}.{payload}.{sig}");
        let err = decode_account_id(&token).unwrap_err();
        assert!(matches!(err, OAuthError::Decode(_)));
    }

    #[tokio::test]
    async fn exchange_code_parses_tokens_and_account_id() {
        let server = MockServer::start().await;
        let id_token = encode_id_token("acct_teacher_1");
        Mock::given(method("POST"))
            .and(path("/oauth/token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "at-123",
                "refresh_token": "rt-123",
                "id_token": id_token,
                "expires_in": 7200,
            })))
            .mount(&server)
            .await;

        let oauth = CodexOAuth::with_base_url(server.uri());
        let pkce = PkcePair::from_verifier_bytes(&[2u8; 32]);
        let tokens = oauth
            .exchange_code("authcode-xyz", &pkce.verifier)
            .await
            .unwrap();
        assert_eq!(tokens.access_token, "at-123");
        assert_eq!(tokens.refresh_token, "rt-123");
        assert_eq!(tokens.account_id, "acct_teacher_1");
        assert_eq!(tokens.expires_in, 7200);
    }

    #[tokio::test]
    async fn exchange_code_surfaces_remote_errors() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/oauth/token"))
            .respond_with(
                ResponseTemplate::new(400).set_body_string(r#"{"error":"invalid_grant"}"#),
            )
            .mount(&server)
            .await;
        let oauth = CodexOAuth::with_base_url(server.uri());
        let err = oauth.exchange_code("bad", "verifier").await.unwrap_err();
        match err {
            OAuthError::Remote { status, body } => {
                assert_eq!(status, 400);
                assert!(body.contains("invalid_grant"));
            }
            other => panic!("expected Remote, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn refresh_rotates_tokens() {
        let server = MockServer::start().await;
        let id_token = encode_id_token("acct_teacher_1");
        Mock::given(method("POST"))
            .and(path("/oauth/token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "at-refreshed",
                "refresh_token": "rt-rotated",
                "id_token": id_token,
                "expires_in": 3600,
            })))
            .mount(&server)
            .await;
        let oauth = CodexOAuth::with_base_url(server.uri());
        let tokens = oauth.refresh("rt-old").await.unwrap();
        assert_eq!(tokens.access_token, "at-refreshed");
        assert_eq!(tokens.refresh_token, "rt-rotated");
        assert_eq!(tokens.account_id, "acct_teacher_1");
    }

    #[tokio::test]
    async fn refresh_requires_id_token() {
        let server = MockServer::start().await;
        // Response missing id_token → decode error.
        Mock::given(method("POST"))
            .and(path("/oauth/token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "at",
                "refresh_token": "rt",
                "expires_in": 3600,
            })))
            .mount(&server)
            .await;
        let oauth = CodexOAuth::with_base_url(server.uri());
        let err = oauth.refresh("rt-old").await.unwrap_err();
        assert!(matches!(err, OAuthError::Decode(_)));
    }
}
