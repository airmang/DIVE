use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::auth::{self, CodexOAuth, Keyring, PkcePair};
use crate::db::dao::provider_config as provider_dao;
use crate::db::models::NewProviderConfig;
use crate::db::Database;

use super::AppState;

#[derive(Debug, Clone)]
struct PendingFlow {
    provider_config_id: i64,
    pkce_verifier: String,
    csrf_state: String,
    base_auth_url: Option<String>,
}

static PENDING: Lazy<Mutex<Option<PendingFlow>>> = Lazy::new(|| Mutex::new(None));

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexAuthStartResponse {
    pub auth_url: String,
    pub state: String,
    pub provider_config_id: i64,
    pub redirect_uri: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexAuthStatus {
    pub connected: bool,
    pub provider_config_id: Option<i64>,
    pub account_id: Option<String>,
    pub pending: bool,
}

fn ensure_codex_row(db: &Mutex<Database>) -> Result<i64, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let rows = provider_dao::list(db.conn()).map_err(|e| e.to_string())?;
    if let Some(row) = rows.iter().find(|r| r.kind == "codex") {
        return Ok(row.id);
    }
    provider_dao::insert(
        db.conn(),
        &NewProviderConfig {
            kind: "codex".into(),
            auth_type: "oauth".into(),
            base_url: None,
            config: serde_json::Value::Object(serde_json::Map::new()),
        },
    )
    .map_err(|e| e.to_string())
}

fn codex_provider_id(db: &Mutex<Database>) -> Result<Option<i64>, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let rows = provider_dao::list(db.conn()).map_err(|e| e.to_string())?;
    Ok(rows.into_iter().find(|r| r.kind == "codex").map(|r| r.id))
}

async fn start_impl(
    db: &Mutex<Database>,
    base_auth_url: Option<String>,
) -> Result<CodexAuthStartResponse, String> {
    let provider_config_id = ensure_codex_row(db)?;
    let oauth = match &base_auth_url {
        Some(url) => CodexOAuth::with_base_url(url),
        None => CodexOAuth::new(),
    };
    let pkce = PkcePair::generate();
    let csrf = auth::codex_oauth::random_state();
    let url = oauth.authorization_url(&pkce, &csrf);
    let redirect_uri = oauth.redirect_uri().to_string();
    let mut guard = PENDING.lock().map_err(|e| e.to_string())?;
    *guard = Some(PendingFlow {
        provider_config_id,
        pkce_verifier: pkce.verifier,
        csrf_state: csrf.clone(),
        base_auth_url,
    });
    Ok(CodexAuthStartResponse {
        auth_url: url,
        state: csrf,
        provider_config_id,
        redirect_uri,
    })
}

async fn complete_impl(
    keyring: &dyn Keyring,
    code: &str,
    received_state: &str,
) -> Result<CodexAuthStatus, String> {
    let pending = {
        let mut guard = PENDING.lock().map_err(|e| e.to_string())?;
        guard
            .take()
            .ok_or_else(|| "no pending OAuth flow: call codex_oauth_start first".to_string())?
    };
    if pending.csrf_state != received_state {
        return Err("state mismatch: possible CSRF".into());
    }
    let oauth = match &pending.base_auth_url {
        Some(url) => CodexOAuth::with_base_url(url),
        None => CodexOAuth::new(),
    };
    let tokens = oauth
        .exchange_code(code, &pending.pkce_verifier)
        .await
        .map_err(|e| e.to_string())?;
    auth::store_codex_tokens(keyring, pending.provider_config_id, &tokens)
        .map_err(|e| format!("keyring: {e}"))?;
    Ok(CodexAuthStatus {
        connected: true,
        provider_config_id: Some(pending.provider_config_id),
        account_id: Some(tokens.account_id),
        pending: false,
    })
}

fn status_impl(db: &Mutex<Database>, keyring: &dyn Keyring) -> Result<CodexAuthStatus, String> {
    let pending_present = PENDING.lock().map_err(|e| e.to_string())?.is_some();
    let Some(id) = codex_provider_id(db)? else {
        return Ok(CodexAuthStatus {
            connected: false,
            provider_config_id: None,
            account_id: None,
            pending: pending_present,
        });
    };
    let tokens_opt = auth::load_codex_tokens(keyring, id).map_err(|e| format!("keyring: {e}"))?;
    let connected = tokens_opt.is_some();
    let account_id = tokens_opt.as_ref().and_then(|(_, _, id_token)| {
        if id_token.is_empty() {
            None
        } else {
            auth::codex_oauth::decode_account_id(id_token).ok()
        }
    });
    Ok(CodexAuthStatus {
        connected,
        provider_config_id: Some(id),
        account_id,
        pending: pending_present,
    })
}

fn logout_impl(db: &Mutex<Database>, keyring: &dyn Keyring) -> Result<(), String> {
    if let Some(id) = codex_provider_id(db)? {
        auth::delete_codex_tokens(keyring, id).map_err(|e| format!("keyring: {e}"))?;
        let db = db.lock().map_err(|e| e.to_string())?;
        provider_dao::delete(db.conn(), id).map_err(|e| e.to_string())?;
    }
    let mut guard = PENDING.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

async fn refresh_impl(
    db: &Mutex<Database>,
    keyring: &dyn Keyring,
    base_auth_url: Option<String>,
) -> Result<CodexAuthStatus, String> {
    let id = codex_provider_id(db)?.ok_or_else(|| "codex not connected".to_string())?;
    let (_access, refresh, _id_token) = auth::load_codex_tokens(keyring, id)
        .map_err(|e| format!("keyring: {e}"))?
        .ok_or_else(|| "codex tokens missing".to_string())?;
    let oauth = match base_auth_url {
        Some(url) => CodexOAuth::with_base_url(url),
        None => CodexOAuth::new(),
    };
    let new_tokens = oauth.refresh(&refresh).await.map_err(|e| e.to_string())?;
    auth::store_codex_tokens(keyring, id, &new_tokens).map_err(|e| format!("keyring: {e}"))?;
    Ok(CodexAuthStatus {
        connected: true,
        provider_config_id: Some(id),
        account_id: Some(new_tokens.account_id),
        pending: false,
    })
}

#[tauri::command]
pub async fn codex_oauth_start(
    state: State<'_, AppState>,
    base_auth_url: Option<String>,
) -> Result<CodexAuthStartResponse, String> {
    start_impl(state.db.as_ref(), base_auth_url).await
}

#[tauri::command]
pub async fn codex_oauth_complete(
    state: State<'_, AppState>,
    code: String,
    received_state: String,
) -> Result<CodexAuthStatus, String> {
    complete_impl(state.keyring.as_ref(), &code, &received_state).await
}

#[tauri::command]
pub async fn codex_oauth_status(state: State<'_, AppState>) -> Result<CodexAuthStatus, String> {
    status_impl(state.db.as_ref(), state.keyring.as_ref())
}

#[tauri::command]
pub async fn codex_oauth_logout(state: State<'_, AppState>) -> Result<(), String> {
    logout_impl(state.db.as_ref(), state.keyring.as_ref())
}

#[tauri::command]
pub async fn codex_oauth_refresh(state: State<'_, AppState>) -> Result<CodexAuthStatus, String> {
    refresh_impl(state.db.as_ref(), state.keyring.as_ref(), None).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::InMemoryKeyring;
    use once_cell::sync::Lazy;
    use std::sync::Arc;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    static TEST_LOCK: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));

    fn encode_id_token(account_id: &str) -> String {
        use base64::engine::general_purpose::URL_SAFE_NO_PAD;
        use base64::Engine as _;
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none"}"#);
        let payload_json = serde_json::json!({
            "https://api.openai.com/auth": {
                "chatgpt_account_id": account_id,
            },
            "sub": "user_1",
        });
        let payload = URL_SAFE_NO_PAD.encode(payload_json.to_string());
        let signature = URL_SAFE_NO_PAD.encode("sig");
        format!("{header}.{payload}.{signature}")
    }

    fn mk_fixtures() -> (Arc<Mutex<Database>>, Arc<InMemoryKeyring>) {
        let mut db = Database::open_in_memory().unwrap();
        db.migrate().unwrap();
        let db = Arc::new(Mutex::new(db));
        let keyring = Arc::new(InMemoryKeyring::new());
        {
            let mut guard = PENDING.lock().unwrap();
            *guard = None;
        }
        (db, keyring)
    }

    #[tokio::test]
    async fn start_then_complete_stores_tokens() {
        let _guard = TEST_LOCK.lock().await;
        let server = MockServer::start().await;
        let id_token = encode_id_token("acct_codex_1");
        Mock::given(method("POST"))
            .and(path("/oauth/token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "at-ok",
                "refresh_token": "rt-ok",
                "id_token": id_token,
                "expires_in": 3600,
            })))
            .mount(&server)
            .await;

        let (db, keyring) = mk_fixtures();
        let started = start_impl(db.as_ref(), Some(server.uri())).await.unwrap();
        assert!(started.auth_url.contains("/oauth/authorize"));
        assert_eq!(started.provider_config_id, 1);

        let status = complete_impl(keyring.as_ref(), "the-code", &started.state)
            .await
            .unwrap();
        assert!(status.connected);
        assert_eq!(status.account_id.as_deref(), Some("acct_codex_1"));

        let check = status_impl(db.as_ref(), keyring.as_ref()).unwrap();
        assert!(check.connected);
        assert_eq!(check.account_id.as_deref(), Some("acct_codex_1"));
    }

    #[tokio::test]
    async fn complete_without_start_returns_error() {
        let _guard = TEST_LOCK.lock().await;
        let (_db, keyring) = mk_fixtures();
        let err = complete_impl(keyring.as_ref(), "code", "state")
            .await
            .unwrap_err();
        assert!(err.contains("no pending OAuth flow"));
    }

    #[tokio::test]
    async fn complete_with_wrong_state_is_csrf_error() {
        let _guard = TEST_LOCK.lock().await;
        let server = MockServer::start().await;
        let (db, keyring) = mk_fixtures();
        let _ = start_impl(db.as_ref(), Some(server.uri())).await.unwrap();
        let err = complete_impl(keyring.as_ref(), "code", "wrong-state")
            .await
            .unwrap_err();
        assert!(err.contains("state mismatch"));
    }

    #[tokio::test]
    async fn logout_clears_tokens_and_row() {
        let _guard = TEST_LOCK.lock().await;
        let server = MockServer::start().await;
        let id_token = encode_id_token("acct_codex_1");
        Mock::given(method("POST"))
            .and(path("/oauth/token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "at-ok",
                "refresh_token": "rt-ok",
                "id_token": id_token,
                "expires_in": 3600,
            })))
            .mount(&server)
            .await;
        let (db, keyring) = mk_fixtures();
        let started = start_impl(db.as_ref(), Some(server.uri())).await.unwrap();
        complete_impl(keyring.as_ref(), "code", &started.state)
            .await
            .unwrap();
        logout_impl(db.as_ref(), keyring.as_ref()).unwrap();
        let status = status_impl(db.as_ref(), keyring.as_ref()).unwrap();
        assert!(!status.connected);
    }

    #[tokio::test]
    async fn refresh_rotates_stored_tokens() {
        let _guard = TEST_LOCK.lock().await;
        let server = MockServer::start().await;
        let id_token = encode_id_token("acct_codex_1");
        Mock::given(method("POST"))
            .and(path("/oauth/token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "at-1",
                "refresh_token": "rt-1",
                "id_token": id_token,
                "expires_in": 3600,
            })))
            .expect(2)
            .mount(&server)
            .await;
        let (db, keyring) = mk_fixtures();
        let started = start_impl(db.as_ref(), Some(server.uri())).await.unwrap();
        complete_impl(keyring.as_ref(), "code", &started.state)
            .await
            .unwrap();
        let status = refresh_impl(db.as_ref(), keyring.as_ref(), Some(server.uri()))
            .await
            .unwrap();
        assert!(status.connected);
        assert_eq!(status.account_id.as_deref(), Some("acct_codex_1"));
    }
}
