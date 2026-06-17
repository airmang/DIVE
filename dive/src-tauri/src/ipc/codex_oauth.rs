use std::sync::{Arc, Mutex};
use std::time::Duration;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::auth::{self, CodexOAuth, Keyring, PkcePair};
use crate::db::dao::provider_config as provider_dao;
use crate::db::models::{NewProviderConfig, ProviderConfigRow};
use crate::db::Database;

use super::{AppState, ProviderKind, ProviderRuntime};

#[derive(Debug, Clone)]
struct PendingFlow {
    provider_config_id: i64,
    pkce_verifier: String,
    csrf_state: String,
    base_auth_url: Option<String>,
}

static PENDING: Lazy<Mutex<Option<PendingFlow>>> = Lazy::new(|| Mutex::new(None));
const CALLBACK_BIND_ADDR: &str = "127.0.0.1:1455";
const CALLBACK_PATH: &str = "/auth/callback";
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(10 * 60);

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
            config: serde_json::json!({
                "selected_model": crate::providers::default_model_for_kind("codex")
            }),
        },
    )
    .map_err(|e| e.to_string())
}

fn selected_model_for_codex_row(
    state: &AppState,
    provider_config_id: i64,
) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let row = provider_dao::get_by_id(db.conn(), provider_config_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("codex provider not found: {provider_config_id}"))?;
    let selected = row
        .config
        .get("selected_model")
        .or_else(|| row.config.get("model"))
        .and_then(|value| value.as_str())
        .or_else(|| Some(crate::providers::default_model_for_kind("codex")));
    Ok(crate::providers::normalize_model_for_kind(
        "codex", selected,
    ))
}

fn mark_codex_connected(
    state: &AppState,
    provider_config_id: i64,
    account_id: &str,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let row = provider_dao::get_by_id(db.conn(), provider_config_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("codex provider not found: {provider_config_id}"))?;
    let mut config = row.config.as_object().cloned().unwrap_or_default();
    config.insert("oauth_connected".to_owned(), serde_json::json!(true));
    config.insert("account_id".to_owned(), serde_json::json!(account_id));
    config.remove("oauth_invalidated_at");
    config.remove("oauth_invalidated_reason");
    provider_dao::update(
        db.conn(),
        provider_config_id,
        &NewProviderConfig {
            kind: row.kind,
            auth_type: row.auth_type,
            base_url: row.base_url,
            config: serde_json::Value::Object(config),
        },
    )
    .map_err(|e| e.to_string())
}

fn activate_codex_runtime(state: &AppState, provider_config_id: i64) -> Result<(), String> {
    let (access_token, refresh_token, id_token) =
        auth::load_codex_tokens(state.keyring.as_ref(), provider_config_id)
            .map_err(|e| format!("keyring: {e}"))?
            .ok_or_else(|| "codex tokens missing after OAuth".to_string())?;
    let account_id = auth::codex_oauth::decode_account_id(&id_token).map_err(|e| e.to_string())?;
    let model = selected_model_for_codex_row(state, provider_config_id)?;
    let provider = Arc::new(crate::providers::CodexProvider::new(
        auth::CodexTokens {
            access_token,
            refresh_token,
            id_token,
            account_id,
            expires_in: 0,
        },
        CodexOAuth::new(),
    ));
    state
        .swap_runtime(ProviderRuntime::new(
            Some(provider_config_id),
            ProviderKind::Codex,
            model,
            provider,
        ))
        .map_err(|e| format!("runtime: {e}"))
}

fn codex_provider_row(db: &Mutex<Database>) -> Result<Option<ProviderConfigRow>, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let rows = provider_dao::list(db.conn()).map_err(|e| e.to_string())?;
    Ok(rows.into_iter().find(|r| r.kind == "codex"))
}

fn codex_provider_id(db: &Mutex<Database>) -> Result<Option<i64>, String> {
    Ok(codex_provider_row(db)?.map(|row| row.id))
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
        let guard = PENDING.lock().map_err(|e| e.to_string())?;
        guard
            .clone()
            .ok_or_else(|| "no pending OAuth flow: call codex_oauth_start first".to_string())?
    };
    let parsed = parse_authorization_input(code);
    let authorization_code = parsed.code.as_deref().unwrap_or(code).trim();
    let state = parsed.state.as_deref().unwrap_or(received_state).trim();
    if pending.csrf_state != state {
        return Err("state mismatch: possible CSRF".into());
    }
    if authorization_code.is_empty() {
        return Err("missing authorization code".into());
    }
    let oauth = match &pending.base_auth_url {
        Some(url) => CodexOAuth::with_base_url(url),
        None => CodexOAuth::new(),
    };
    let tokens = oauth
        .exchange_code(authorization_code, &pending.pkce_verifier)
        .await
        .map_err(|e| e.to_string())?;
    auth::store_codex_tokens(keyring, pending.provider_config_id, &tokens)
        .map_err(|e| format!("keyring: {e}"))?;
    {
        let mut guard = PENDING.lock().map_err(|e| e.to_string())?;
        *guard = None;
    }
    Ok(CodexAuthStatus {
        connected: true,
        provider_config_id: Some(pending.provider_config_id),
        account_id: Some(tokens.account_id),
        pending: false,
    })
}

async fn complete_and_activate_impl(
    state: &AppState,
    code: &str,
    received_state: &str,
) -> Result<CodexAuthStatus, String> {
    let status = complete_impl(state.keyring.as_ref(), code, received_state).await?;
    if let Some(provider_config_id) = status.provider_config_id {
        if let Some(account_id) = status.account_id.as_deref() {
            mark_codex_connected(state, provider_config_id, account_id)?;
        }
        activate_codex_runtime(state, provider_config_id)?;
    }
    Ok(status)
}

fn request_target_matches_callback(target: &str) -> bool {
    target
        .split_once('?')
        .map(|(path, _)| path)
        .unwrap_or(target)
        == CALLBACK_PATH
}

fn response_html(title: &str, body: &str) -> String {
    format!(
        "<!doctype html><meta charset=\"utf-8\"><title>{title}</title><body style=\"font-family: system-ui; margin: 2rem;\"><h1>{title}</h1><p>{body}</p></body>"
    )
}

async fn write_http_response(
    stream: &mut tokio::net::TcpStream,
    status: &str,
    body: &str,
) -> std::io::Result<()> {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes()).await
}

async fn run_callback_server_once(app: AppHandle, state: AppState) -> Result<(), String> {
    let listener = TcpListener::bind(CALLBACK_BIND_ADDR)
        .await
        .map_err(|err| format!("callback bind: {err}"))?;
    let (mut stream, _) = tokio::time::timeout(CALLBACK_TIMEOUT, listener.accept())
        .await
        .map_err(|_| "callback timed out".to_string())?
        .map_err(|err| format!("callback accept: {err}"))?;

    let mut buf = vec![0u8; 8192];
    let n = stream
        .read(&mut buf)
        .await
        .map_err(|err| format!("callback read: {err}"))?;
    let request = String::from_utf8_lossy(&buf[..n]);
    let target = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| "callback request missing target".to_string())?;

    if !request_target_matches_callback(target) {
        let body = response_html(
            "DIVE OAuth callback not found",
            "This callback URL is not handled by DIVE.",
        );
        let _ = write_http_response(&mut stream, "404 Not Found", &body).await;
        return Err(format!("unexpected callback path: {target}"));
    }

    let parsed = parse_authorization_input(target);
    let code = parsed
        .code
        .as_deref()
        .ok_or_else(|| "callback missing code".to_string())?;
    let state_value = parsed
        .state
        .as_deref()
        .ok_or_else(|| "callback missing state".to_string())?;

    match complete_and_activate_impl(&state, code, state_value).await {
        Ok(status) => {
            let body = response_html(
                "DIVE Codex OAuth connected",
                "You can close this browser tab and return to DIVE.",
            );
            let _ = write_http_response(&mut stream, "200 OK", &body).await;
            let _ = app.emit("codex://oauth-complete", &status);
            if let Some(provider_config_id) = status.provider_config_id {
                super::provider::emit_provider_changed(
                    &app,
                    provider_config_id,
                    ProviderKind::Codex.as_str(),
                    "codex_oauth_connected",
                );
            }
            Ok(())
        }
        Err(err) => {
            let body = response_html(
                "DIVE Codex OAuth failed",
                "Return to DIVE and try starting the login again.",
            );
            let _ = write_http_response(&mut stream, "400 Bad Request", &body).await;
            let _ = app.emit("codex://oauth-error", err.clone());
            Err(err)
        }
    }
}

fn spawn_callback_server(app: AppHandle, state: AppState) {
    tokio::spawn(async move {
        if let Err(err) = run_callback_server_once(app, state).await {
            tracing::warn!(
                error = %crate::telemetry::redact_log_text(&err),
                "codex oauth callback server stopped"
            );
        }
    });
}

#[derive(Debug, Default, PartialEq, Eq)]
struct ParsedAuthorizationInput {
    code: Option<String>,
    state: Option<String>,
}

fn parse_authorization_input(input: &str) -> ParsedAuthorizationInput {
    let value = input.trim();
    if value.is_empty() {
        return ParsedAuthorizationInput::default();
    }

    let query_or_fragment = value
        .split_once('?')
        .map(|(_, rest)| rest)
        .or_else(|| value.split_once('#').map(|(_, rest)| rest))
        .unwrap_or(value);
    let query = query_or_fragment
        .split_once('#')
        .map(|(before, _)| before)
        .unwrap_or(query_or_fragment);

    if !query.contains("code=") && !query.contains("state=") {
        return ParsedAuthorizationInput {
            code: Some(value.to_owned()),
            state: None,
        };
    }

    let mut parsed = ParsedAuthorizationInput::default();
    for pair in query.split('&') {
        let Some((key, raw_value)) = pair.split_once('=') else {
            continue;
        };
        match key {
            "code" => parsed.code = Some(percent_decode_form_value(raw_value)),
            "state" => parsed.state = Some(percent_decode_form_value(raw_value)),
            _ => {}
        }
    }
    parsed
}

fn percent_decode_form_value(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hi = (bytes[i + 1] as char).to_digit(16);
                let lo = (bytes[i + 2] as char).to_digit(16);
                if let (Some(hi), Some(lo)) = (hi, lo) {
                    out.push(((hi << 4) | lo) as u8);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn status_impl(db: &Mutex<Database>, keyring: &dyn Keyring) -> Result<CodexAuthStatus, String> {
    let pending_present = PENDING.lock().map_err(|e| e.to_string())?.is_some();
    let Some(row) = codex_provider_row(db)? else {
        return Ok(CodexAuthStatus {
            connected: false,
            provider_config_id: None,
            account_id: None,
            pending: pending_present,
        });
    };
    let id = row.id;
    let tokens_opt = auth::load_codex_tokens(keyring, id).map_err(|e| format!("keyring: {e}"))?;
    let config_marked_disconnected =
        super::provider::is_codex_config_marked_disconnected(&row.config);
    let connected = tokens_opt.is_some() && !config_marked_disconnected;
    let token_account_id = tokens_opt.as_ref().and_then(|(_, _, id_token)| {
        if id_token.is_empty() {
            None
        } else {
            auth::codex_oauth::decode_account_id(id_token).ok()
        }
    });
    let account_id = token_account_id.or_else(|| {
        row.config
            .get("account_id")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    });
    Ok(CodexAuthStatus {
        connected,
        provider_config_id: Some(id),
        account_id,
        pending: pending_present,
    })
}

fn logout_impl(db: &Mutex<Database>, keyring: &dyn Keyring) -> Result<Option<i64>, String> {
    let provider_config_id = codex_provider_id(db)?;
    if let Some(id) = provider_config_id {
        auth::delete_codex_tokens(keyring, id).map_err(|e| format!("keyring: {e}"))?;
        let db = db.lock().map_err(|e| e.to_string())?;
        provider_dao::delete(db.conn(), id).map_err(|e| e.to_string())?;
    }
    let mut guard = PENDING.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(provider_config_id)
}

async fn refresh_impl(
    db: &Mutex<Database>,
    keyring: &dyn Keyring,
    base_auth_url: Option<String>,
) -> Result<CodexAuthStatus, String> {
    let row = codex_provider_row(db)?.ok_or_else(|| "codex not connected".to_string())?;
    let id = row.id;
    if super::provider::is_codex_config_marked_disconnected(&row.config) {
        return Ok(CodexAuthStatus {
            connected: false,
            provider_config_id: Some(id),
            account_id: row
                .config
                .get("account_id")
                .and_then(|value| value.as_str())
                .filter(|value| !value.is_empty())
                .map(str::to_owned),
            pending: false,
        });
    }
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
    app: AppHandle,
    state: State<'_, AppState>,
    base_auth_url: Option<String>,
) -> Result<CodexAuthStartResponse, String> {
    let response = start_impl(state.db.as_ref(), base_auth_url).await?;
    spawn_callback_server(app, state.inner().clone());
    Ok(response)
}

#[tauri::command]
pub async fn codex_oauth_complete(
    app: AppHandle,
    state: State<'_, AppState>,
    code: String,
    received_state: String,
) -> Result<CodexAuthStatus, String> {
    let status = complete_and_activate_impl(&state, &code, &received_state).await?;
    if let Some(provider_config_id) = status.provider_config_id {
        super::provider::emit_provider_changed(
            &app,
            provider_config_id,
            ProviderKind::Codex.as_str(),
            "codex_oauth_connected",
        );
    }
    Ok(status)
}

#[tauri::command]
pub async fn codex_oauth_status(state: State<'_, AppState>) -> Result<CodexAuthStatus, String> {
    status_impl(state.db.as_ref(), state.keyring.as_ref())
}

#[tauri::command]
pub async fn codex_oauth_logout(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let provider_config_id = logout_impl(state.db.as_ref(), state.keyring.as_ref())?;
    if state.runtime_snapshot().kind == ProviderKind::Codex {
        state
            .swap_runtime(ProviderRuntime::none())
            .map_err(|e| format!("runtime: {e}"))?;
    }
    if let Some(provider_config_id) = provider_config_id {
        super::provider::emit_provider_changed(
            &app,
            provider_config_id,
            ProviderKind::Codex.as_str(),
            "codex_oauth_logout",
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn codex_oauth_refresh(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CodexAuthStatus, String> {
    let status = refresh_impl(state.db.as_ref(), state.keyring.as_ref(), None).await?;
    if let Some(provider_config_id) = status.provider_config_id {
        if status.connected {
            activate_codex_runtime(&state, provider_config_id)?;
        }
        super::provider::emit_provider_changed(
            &app,
            provider_config_id,
            ProviderKind::Codex.as_str(),
            "codex_oauth_refreshed",
        );
    }
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::InMemoryKeyring;
    use crate::providers::MockProvider;
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

    #[test]
    fn mark_codex_connected_clears_stale_invalidated_marker() {
        let mut db = Database::open_in_memory().unwrap();
        db.migrate().unwrap();
        let id = provider_dao::insert(
            db.conn(),
            &NewProviderConfig {
                kind: "codex".into(),
                auth_type: "oauth".into(),
                base_url: None,
                config: serde_json::json!({
                    "selected_model": "gpt-5.5",
                    "oauth_connected": false,
                    "oauth_invalidated_at": 12345,
                    "oauth_invalidated_reason": "codex_auth_invalidated",
                }),
            },
        )
        .unwrap();
        let state = AppState::new(
            db,
            Arc::new(MockProvider::new(Vec::new())),
            std::env::temp_dir(),
            "mock".into(),
        )
        .with_keyring(Arc::new(InMemoryKeyring::new()));

        mark_codex_connected(&state, id, "acct_reconnected").unwrap();

        let db = state.db.lock().unwrap();
        let row = provider_dao::get_by_id(db.conn(), id).unwrap().unwrap();
        assert_eq!(
            row.config
                .get("oauth_connected")
                .and_then(|value| value.as_bool()),
            Some(true)
        );
        assert_eq!(
            row.config
                .get("account_id")
                .and_then(|value| value.as_str()),
            Some("acct_reconnected")
        );
        assert!(row.config.get("oauth_invalidated_at").is_none());
        assert!(row.config.get("oauth_invalidated_reason").is_none());
    }

    #[test]
    fn status_reports_invalidated_codex_config_as_disconnected_even_with_tokens() {
        let mut db = Database::open_in_memory().unwrap();
        db.migrate().unwrap();
        let id = provider_dao::insert(
            db.conn(),
            &NewProviderConfig {
                kind: "codex".into(),
                auth_type: "oauth".into(),
                base_url: None,
                config: serde_json::json!({
                    "selected_model": "gpt-5.5",
                    "oauth_connected": false,
                    "oauth_invalidated_at": 12345,
                    "account_id": "acct_invalidated_status",
                }),
            },
        )
        .unwrap();
        let db = Arc::new(Mutex::new(db));
        let keyring = Arc::new(InMemoryKeyring::new());
        auth::store_codex_tokens(
            keyring.as_ref(),
            id,
            &auth::CodexTokens {
                access_token: "at".into(),
                refresh_token: "rt".into(),
                id_token: encode_id_token("acct_invalidated_status"),
                account_id: "acct_invalidated_status".into(),
                expires_in: 3600,
            },
        )
        .unwrap();

        let status = status_impl(db.as_ref(), keyring.as_ref()).unwrap();

        assert!(!status.connected);
        assert_eq!(status.provider_config_id, Some(id));
        assert_eq!(
            status.account_id.as_deref(),
            Some("acct_invalidated_status")
        );
    }

    #[test]
    fn parse_authorization_input_accepts_full_callback_url() {
        assert_eq!(
            parse_authorization_input(
                "http://localhost:1455/auth/callback?code=abc%2F123&state=csrf-456"
            ),
            ParsedAuthorizationInput {
                code: Some("abc/123".into()),
                state: Some("csrf-456".into()),
            }
        );
    }

    #[test]
    fn parse_authorization_input_accepts_plain_code() {
        assert_eq!(
            parse_authorization_input("plain-code"),
            ParsedAuthorizationInput {
                code: Some("plain-code".into()),
                state: None,
            }
        );
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
