use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::auth;
use crate::db::dao::provider_config as provider_dao;
use crate::db::models::{NewProviderConfig, ProviderConfigRow};
use crate::providers::ModelInfo;

use super::{AppState, ProviderKind, ProviderRuntime};

pub(crate) const PROVIDER_CHANGED_EVENT: &str = "provider://changed";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderChangedPayload {
    pub provider_config_id: i64,
    pub kind: String,
    pub reason: String,
}

pub(crate) fn emit_provider_changed(
    app: &AppHandle,
    provider_config_id: i64,
    kind: &str,
    reason: &str,
) {
    let _ = app.emit(
        PROVIDER_CHANGED_EVENT,
        ProviderChangedPayload {
            provider_config_id,
            kind: kind.to_owned(),
            reason: reason.to_owned(),
        },
    );
}

pub(crate) fn is_codex_auth_invalidated_message(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("token_invalidated")
        || (lower.contains("authentication token") && lower.contains("invalidated"))
        || (lower.contains("401") && lower.contains("invalid"))
}

pub(crate) fn is_codex_config_marked_disconnected(config: &Value) -> bool {
    config.get("oauth_invalidated_at").is_some()
        || config
            .get("oauth_connected")
            .and_then(|value| value.as_bool())
            == Some(false)
}

fn selected_model_from_config(config: &Value) -> Option<String> {
    config
        .get("selected_model")
        .or_else(|| config.get("model"))
        .and_then(|value| value.as_str())
        .map(str::to_owned)
}

fn selected_model_for_kind(kind: &str, config: &Value) -> String {
    crate::providers::normalize_model_for_kind(kind, selected_model_from_config(config).as_deref())
}

fn model_needs_repair(kind: &str, config: &Value, normalized: &str) -> bool {
    selected_model_from_config(config)
        .as_deref()
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .is_some_and(|stored| {
            stored != normalized && !crate::providers::models_for_kind(kind).is_empty()
        })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfigSummary {
    pub id: i64,
    pub kind: String,
    pub auth_type: String,
    pub base_url: Option<String>,
    pub is_connected: bool,
    pub is_active: bool,
    pub selected_model: Option<String>,
    pub account_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfoDto {
    pub id: String,
    pub display_name: String,
}

impl From<ModelInfo> for ModelInfoDto {
    fn from(model: ModelInfo) -> Self {
        Self {
            id: model.id,
            display_name: model.display_name,
        }
    }
}

#[tauri::command]
pub async fn provider_connect(
    state: State<'_, AppState>,
    kind: String,
    api_key: String,
    base_url: Option<String>,
) -> Result<ProviderConfigSummary, String> {
    provider_connect_impl(&state, kind, api_key, base_url).await
}

pub async fn provider_connect_impl(
    state: &AppState,
    kind: String,
    api_key: String,
    base_url: Option<String>,
) -> Result<ProviderConfigSummary, String> {
    let trimmed_key = api_key.trim();
    if trimmed_key.is_empty() {
        return Err("api_key cannot be empty".into());
    }
    tracing::info!(
        provider_kind = %kind,
        has_custom_base_url = base_url.is_some(),
        "provider_connect started"
    );
    let base_url = crate::providers::validate_provider_base_url(&kind, base_url.as_deref())
        .map_err(|e| e.to_string())?;
    crate::providers::health_check(&kind, trimmed_key, base_url.as_deref())
        .await
        .map_err(|e| {
            tracing::warn!(
                provider_kind = %kind,
                error = %crate::telemetry::redact_log_text(&e.to_string()),
                "provider health check failed"
            );
            e.to_string()
        })?;
    let provider = crate::providers::build_provider(&kind, trimmed_key, base_url.as_deref())
        .map_err(|e| {
            tracing::warn!(
                provider_kind = %kind,
                error = %crate::telemetry::redact_log_text(&e.to_string()),
                "provider build failed"
            );
            e.to_string()
        })?;
    let parsed_kind = crate::ipc::ProviderKind::parse(&kind);
    let canonical_kind = parsed_kind.as_str().to_owned();
    let model = crate::providers::default_model_for_kind(&canonical_kind).to_owned();
    let id = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        provider_dao::insert(
            db.conn(),
            &NewProviderConfig {
                kind: canonical_kind.clone(),
                auth_type: "api_key".into(),
                base_url: base_url.clone(),
                config: json!({ "selected_model": model }),
            },
        )
        .map_err(|e| e.to_string())?
    };
    if let Err(err) = auth::upsert_provider_api_key(state.keyring.as_ref(), id, trimmed_key) {
        if let Ok(db) = state.db.lock() {
            let _ = provider_dao::delete(db.conn(), id);
        }
        return Err(format!("keyring: {err}"));
    }
    state
        .swap_runtime(crate::ipc::ProviderRuntime::new(
            Some(id),
            parsed_kind,
            model.clone(),
            provider,
        ))
        .map_err(|e| format!("runtime: {e}"))?;
    tracing::info!(
        provider_kind = %canonical_kind,
        provider_config_id = id,
        "provider_connect completed"
    );
    Ok(ProviderConfigSummary {
        id,
        kind: canonical_kind,
        auth_type: "api_key".into(),
        base_url,
        is_connected: true,
        is_active: true,
        selected_model: Some(model),
        account_id: None,
    })
}

#[tauri::command]
pub async fn provider_list(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderConfigSummary>, String> {
    provider_list_command_impl(state.inner())
}

pub fn provider_list_command_impl(state: &AppState) -> Result<Vec<ProviderConfigSummary>, String> {
    provider_list_impl(state)
}

pub fn provider_list_impl(state: &AppState) -> Result<Vec<ProviderConfigSummary>, String> {
    let rows = provider_rows(state)?;
    repair_stale_selected_models(state, &rows)?;
    Ok(summaries_from_rows(
        rows,
        state.keyring.as_ref(),
        state.runtime_snapshot().config_id,
    ))
}

fn provider_rows(state: &AppState) -> Result<Vec<ProviderConfigRow>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    provider_dao::list(db.conn()).map_err(|e| e.to_string())
}

fn summaries_from_rows(
    rows: Vec<ProviderConfigRow>,
    keyring: &dyn auth::Keyring,
    active_provider_id: Option<i64>,
) -> Vec<ProviderConfigSummary> {
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let selected_model = Some(selected_model_for_kind(&row.kind, &row.config));
        let (is_connected, account_id) = connection_summary(&row, keyring);
        let is_active = is_connected && active_provider_id == Some(row.id);
        out.push(ProviderConfigSummary {
            id: row.id,
            kind: row.kind,
            auth_type: row.auth_type,
            base_url: row.base_url,
            is_connected,
            is_active,
            selected_model,
            account_id,
        });
    }
    out
}

fn repair_stale_selected_models(
    state: &AppState,
    rows: &[ProviderConfigRow],
) -> Result<(), String> {
    let repairs = rows
        .iter()
        .filter_map(|row| {
            let normalized = selected_model_for_kind(&row.kind, &row.config);
            if model_needs_repair(&row.kind, &row.config, &normalized) {
                Some((row.id, normalized))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    if repairs.is_empty() {
        return Ok(());
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    for (id, model) in repairs {
        provider_dao::write_selected_model(db.conn(), id, &model).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn connection_summary(
    row: &ProviderConfigRow,
    keyring: &dyn auth::Keyring,
) -> (bool, Option<String>) {
    let account_id = row
        .config
        .get("account_id")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .map(str::to_owned);

    if row.kind == "codex" {
        if is_codex_config_marked_disconnected(&row.config) {
            return (false, account_id);
        }
        let is_connected = auth::load_codex_tokens(keyring, row.id)
            .map(|tokens| tokens.is_some())
            .unwrap_or(false);
        return (is_connected, account_id);
    }

    let is_connected = auth::load_provider_api_key(keyring, row.id)
        .map(|secret| {
            secret
                .as_deref()
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false)
        })
        .unwrap_or(false);
    (is_connected, account_id)
}

#[tauri::command]
pub async fn provider_list_models(
    state: State<'_, AppState>,
    provider_id: i64,
) -> Result<Vec<ModelInfoDto>, String> {
    provider_list_models_impl(&state, provider_id).await
}

pub async fn provider_list_models_impl(
    state: &AppState,
    provider_id: i64,
) -> Result<Vec<ModelInfoDto>, String> {
    let snap = state.runtime_snapshot();
    if snap.config_id == Some(provider_id) {
        return Ok(snap
            .provider
            .list_models()
            .into_iter()
            .map(Into::into)
            .collect());
    }

    let row = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        provider_dao::get_by_id(db.conn(), provider_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("provider not found: {provider_id}"))?
    };
    Ok(crate::providers::models_for_kind(&row.kind)
        .into_iter()
        .map(Into::into)
        .collect())
}

#[tauri::command]
pub async fn provider_set_model(
    state: State<'_, AppState>,
    provider_id: i64,
    model_id: String,
) -> Result<(), String> {
    provider_set_model_impl(&state, provider_id, model_id).await
}

pub async fn provider_set_model_impl(
    state: &AppState,
    provider_id: i64,
    model_id: String,
) -> Result<(), String> {
    let trimmed = model_id.trim().to_owned();
    if trimmed.is_empty() {
        return Err("model_id is empty".into());
    }

    let row = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let row = provider_dao::get_by_id(db.conn(), provider_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("provider not found: {provider_id}"))?;
        let canonical = crate::providers::canonical_model_for_kind(&row.kind, &trimmed);
        crate::providers::validate_model_for_kind(&row.kind, &canonical)
            .map_err(|err| err.to_string())?;
        provider_dao::write_selected_model(db.conn(), provider_id, &canonical)
            .map_err(|e| e.to_string())?;
        (row, canonical)
    };
    let (row, canonical_model) = row;

    let snap = state.runtime_snapshot();
    if snap.config_id == Some(provider_id) {
        state
            .swap_runtime(ProviderRuntime::new(
                Some(provider_id),
                ProviderKind::parse(&row.kind),
                canonical_model,
                snap.provider,
            ))
            .map_err(|e| format!("runtime: {e}"))?;
    } else {
        let _ = provider_select_impl(state, provider_id).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn provider_select(
    state: State<'_, AppState>,
    provider_config_id: i64,
) -> Result<ProviderConfigSummary, String> {
    provider_select_impl(&state, provider_config_id).await
}

pub async fn provider_select_impl(
    state: &AppState,
    provider_config_id: i64,
) -> Result<ProviderConfigSummary, String> {
    tracing::info!(provider_config_id, "provider_select started");
    let row = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        provider_dao::get_by_id(db.conn(), provider_config_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("provider not found: {provider_config_id}"))?
    };
    let (is_connected, account_id) = connection_summary(&row, state.keyring.as_ref());
    if !is_connected {
        return Err(format!("provider is not connected: {provider_config_id}"));
    }
    let runtime = runtime_for_row(&row, state.keyring.as_ref())?;
    let model = runtime.model.clone();
    state
        .swap_runtime(runtime)
        .map_err(|e| format!("runtime: {e}"))?;
    tracing::info!(
        provider_config_id = row.id,
        provider_kind = %row.kind,
        model = %model,
        "provider_select completed"
    );
    Ok(ProviderConfigSummary {
        id: row.id,
        kind: row.kind,
        auth_type: row.auth_type,
        base_url: row.base_url,
        is_connected,
        is_active: true,
        selected_model: Some(model),
        account_id,
    })
}

#[tauri::command]
pub async fn provider_select_runtime(
    state: State<'_, AppState>,
    provider_id: i64,
) -> Result<ProviderConfigSummary, String> {
    provider_select_runtime_impl(&state, provider_id).await
}

pub async fn provider_select_runtime_impl(
    state: &AppState,
    provider_id: i64,
) -> Result<ProviderConfigSummary, String> {
    provider_select_impl(state, provider_id).await
}

fn runtime_for_row(
    row: &ProviderConfigRow,
    keyring: &dyn auth::Keyring,
) -> Result<ProviderRuntime, String> {
    let model = selected_model_for_kind(&row.kind, &row.config);
    if row.kind == "codex" {
        if is_codex_config_marked_disconnected(&row.config) {
            return Err(format!(
                "codex OAuth credentials invalidated for provider {}",
                row.id
            ));
        }
        let (access_token, refresh_token, id_token) = auth::load_codex_tokens(keyring, row.id)
            .map_err(|e| format!("keyring: {e}"))?
            .ok_or_else(|| format!("codex OAuth tokens not found for provider {}", row.id))?;
        let account_id =
            auth::codex_oauth::decode_account_id(&id_token).map_err(|e| e.to_string())?;
        let provider = std::sync::Arc::new(crate::providers::CodexProvider::new(
            auth::CodexTokens {
                access_token,
                refresh_token,
                id_token,
                account_id,
                expires_in: 0,
            },
            auth::CodexOAuth::new(),
        ));
        return Ok(ProviderRuntime::new(
            Some(row.id),
            ProviderKind::parse(&row.kind),
            model,
            provider,
        ));
    }

    let api_key = auth::load_provider_api_key(keyring, row.id)
        .map_err(|e| format!("keyring: {e}"))?
        .ok_or_else(|| format!("API key not found for provider {}", row.id))?;
    let provider = crate::providers::build_provider(&row.kind, &api_key, row.base_url.as_deref())
        .map_err(|e| e.to_string())?;
    Ok(ProviderRuntime::new(
        Some(row.id),
        ProviderKind::parse(&row.kind),
        model,
        provider,
    ))
}

#[tauri::command]
pub async fn provider_disconnect(
    state: State<'_, AppState>,
    provider_config_id: i64,
) -> Result<(), String> {
    provider_disconnect_impl(&state, provider_config_id).await
}

pub async fn provider_disconnect_impl(
    state: &AppState,
    provider_config_id: i64,
) -> Result<(), String> {
    let kind = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        provider_dao::get_by_id(db.conn(), provider_config_id)
            .map_err(|e| e.to_string())?
            .map(|row| row.kind)
    };
    if kind.as_deref() == Some("codex") {
        auth::delete_codex_tokens(state.keyring.as_ref(), provider_config_id)
            .map_err(|e| format!("keyring: {e}"))?;
    } else {
        auth::delete_provider_api_key(state.keyring.as_ref(), provider_config_id)
            .map_err(|e| format!("keyring: {e}"))?;
    }
    let db = state.db.lock().map_err(|e| e.to_string())?;
    provider_dao::delete(db.conn(), provider_config_id).map_err(|e| e.to_string())?;
    drop(db);
    if state.runtime_snapshot().config_id == Some(provider_config_id) {
        state
            .swap_runtime(crate::ipc::ProviderRuntime::none())
            .map_err(|e| format!("runtime: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::InMemoryKeyring;
    use crate::db::Database;
    use crate::providers::MockProvider;
    use std::sync::Arc;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

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

    fn mk_state() -> AppState {
        let mut db = Database::open_in_memory().unwrap();
        db.migrate().unwrap();
        let provider = Arc::new(MockProvider::new(Vec::new()));
        AppState::new(db, provider, std::env::temp_dir(), "mock".into())
            .with_keyring(Arc::new(InMemoryKeyring::new()))
    }

    #[test]
    fn connect_then_disconnect_roundtrip() {
        let state = mk_state();
        let id = {
            let db = state.db.lock().unwrap();
            provider_dao::insert(
                db.conn(),
                &NewProviderConfig {
                    kind: "anthropic".into(),
                    auth_type: "api_key".into(),
                    base_url: None,
                    config: Value::Object(serde_json::Map::new()),
                },
            )
            .unwrap()
        };
        auth::upsert_provider_api_key(state.keyring.as_ref(), id, "sk-test").unwrap();
        assert!(auth::load_provider_api_key(state.keyring.as_ref(), id)
            .unwrap()
            .is_some());
        auth::delete_provider_api_key(state.keyring.as_ref(), id).unwrap();
        assert!(auth::load_provider_api_key(state.keyring.as_ref(), id)
            .unwrap()
            .is_none());
    }

    #[test]
    fn provider_list_reports_codex_oauth_tokens_as_connected() {
        let state = mk_state();
        let id = {
            let db = state.db.lock().unwrap();
            provider_dao::insert(
                db.conn(),
                &NewProviderConfig {
                    kind: "codex".into(),
                    auth_type: "oauth".into(),
                    base_url: None,
                    config: json!({
                        "selected_model": "gpt-5.5-codex",
                        "oauth_connected": true,
                        "account_id": "acct_codex_provider_list",
                    }),
                },
            )
            .unwrap()
        };
        auth::store_codex_tokens(
            state.keyring.as_ref(),
            id,
            &auth::CodexTokens {
                access_token: "at".into(),
                refresh_token: "rt".into(),
                id_token: encode_id_token("acct_codex_provider_list"),
                account_id: "acct_codex_provider_list".into(),
                expires_in: 3600,
            },
        )
        .unwrap();
        state
            .swap_runtime(ProviderRuntime::new(
                Some(id),
                ProviderKind::Codex,
                "gpt-5.5".into(),
                Arc::new(MockProvider::new(Vec::new())),
            ))
            .unwrap();

        let rows = provider_list_impl(&state).unwrap();
        let codex = rows.iter().find(|row| row.id == id).unwrap();
        assert!(codex.is_connected);
        assert_eq!(
            codex.account_id.as_deref(),
            Some("acct_codex_provider_list")
        );
        assert_eq!(codex.selected_model.as_deref(), Some("gpt-5.5"));

        let db = state.db.lock().unwrap();
        let repaired = provider_dao::read_selected_model(db.conn(), id).unwrap();
        assert_eq!(repaired.as_deref(), Some("gpt-5.5"));
    }

    #[test]
    fn provider_list_reports_invalidated_codex_config_as_disconnected_even_with_tokens() {
        let state = mk_state();
        let id = {
            let db = state.db.lock().unwrap();
            provider_dao::insert(
                db.conn(),
                &NewProviderConfig {
                    kind: "codex".into(),
                    auth_type: "oauth".into(),
                    base_url: None,
                    config: json!({
                        "selected_model": "gpt-5.5",
                        "oauth_connected": false,
                        "oauth_invalidated_at": 12345,
                        "account_id": "acct_stale_codex",
                    }),
                },
            )
            .unwrap()
        };
        auth::store_codex_tokens(
            state.keyring.as_ref(),
            id,
            &auth::CodexTokens {
                access_token: "at".into(),
                refresh_token: "rt".into(),
                id_token: encode_id_token("acct_stale_codex"),
                account_id: "acct_stale_codex".into(),
                expires_in: 3600,
            },
        )
        .unwrap();
        state
            .swap_runtime(ProviderRuntime::new(
                Some(id),
                ProviderKind::Codex,
                "gpt-5.5".into(),
                Arc::new(MockProvider::new(Vec::new())),
            ))
            .unwrap();

        let rows = provider_list_impl(&state).unwrap();
        let codex = rows.iter().find(|row| row.id == id).unwrap();

        assert!(!codex.is_connected);
        assert!(!codex.is_active);
        assert_eq!(codex.account_id.as_deref(), Some("acct_stale_codex"));
    }

    #[test]
    fn codex_auth_invalidated_message_detects_revoked_oauth_token() {
        assert!(is_codex_auth_invalidated_message(
            r#"provider error: api error (401): { "error": { "message": "Your authentication token has been invalidated. Please try signing in again.", "code": "token_invalidated" } }"#
        ));
        assert!(is_codex_auth_invalidated_message(
            "provider error: api error (401): invalid credentials"
        ));
        assert!(!is_codex_auth_invalidated_message(
            "provider error: api error (429): rate limit exceeded"
        ));
    }

    #[test]
    fn invalidating_codex_credentials_marks_provider_disconnected_and_clears_runtime() {
        let state = mk_state();
        let id = {
            let db = state.db.lock().unwrap();
            provider_dao::insert(
                db.conn(),
                &NewProviderConfig {
                    kind: "codex".into(),
                    auth_type: "oauth".into(),
                    base_url: None,
                    config: json!({
                        "selected_model": "gpt-5.5",
                        "oauth_connected": true,
                        "account_id": "acct_invalidated",
                    }),
                },
            )
            .unwrap()
        };
        auth::store_codex_tokens(
            state.keyring.as_ref(),
            id,
            &auth::CodexTokens {
                access_token: "at".into(),
                refresh_token: "rt".into(),
                id_token: encode_id_token("acct_invalidated"),
                account_id: "acct_invalidated".into(),
                expires_in: 3600,
            },
        )
        .unwrap();
        state
            .swap_runtime(ProviderRuntime::new(
                Some(id),
                ProviderKind::Codex,
                "gpt-5.5".into(),
                Arc::new(MockProvider::new(Vec::new())),
            ))
            .unwrap();

        state.invalidate_codex_credentials(id).unwrap();

        assert!(auth::load_codex_tokens(state.keyring.as_ref(), id)
            .unwrap()
            .is_none());
        assert!(state.runtime_snapshot().kind.is_none());
        let rows = provider_list_impl(&state).unwrap();
        let codex = rows.iter().find(|row| row.id == id).unwrap();
        assert!(!codex.is_connected);
        assert!(!codex.is_active);
        assert_eq!(codex.account_id.as_deref(), Some("acct_invalidated"));

        let db = state.db.lock().unwrap();
        let row = provider_dao::get_by_id(db.conn(), id).unwrap().unwrap();
        assert_eq!(
            row.config.get("oauth_connected").and_then(Value::as_bool),
            Some(false)
        );
        assert!(row
            .config
            .get("oauth_invalidated_at")
            .and_then(Value::as_i64)
            .is_some());
    }

    #[tokio::test]
    async fn ensure_provider_runtime_drops_stale_codex_runtime_without_tokens() {
        let state = mk_state();
        let id = {
            let db = state.db.lock().unwrap();
            provider_dao::insert(
                db.conn(),
                &NewProviderConfig {
                    kind: "codex".into(),
                    auth_type: "oauth".into(),
                    base_url: None,
                    config: json!({ "selected_model": "gpt-5.5" }),
                },
            )
            .unwrap()
        };
        state
            .swap_runtime(ProviderRuntime::new(
                Some(id),
                ProviderKind::Codex,
                "gpt-5.5".into(),
                Arc::new(MockProvider::new(Vec::new())),
            ))
            .unwrap();

        let snap = state.ensure_provider_runtime().await.unwrap();

        assert!(snap.kind.is_none());
        assert!(state.runtime_snapshot().kind.is_none());
    }

    #[tokio::test]
    async fn provider_select_rejects_invalidated_codex_config_without_activating_runtime() {
        let state = mk_state();
        let id = {
            let db = state.db.lock().unwrap();
            provider_dao::insert(
                db.conn(),
                &NewProviderConfig {
                    kind: "codex".into(),
                    auth_type: "oauth".into(),
                    base_url: None,
                    config: json!({
                        "selected_model": "gpt-5.5",
                        "oauth_connected": false,
                        "oauth_invalidated_at": 12345,
                        "account_id": "acct_invalidated_select",
                    }),
                },
            )
            .unwrap()
        };
        auth::store_codex_tokens(
            state.keyring.as_ref(),
            id,
            &auth::CodexTokens {
                access_token: "at".into(),
                refresh_token: "rt".into(),
                id_token: encode_id_token("acct_invalidated_select"),
                account_id: "acct_invalidated_select".into(),
                expires_in: 3600,
            },
        )
        .unwrap();

        let err = provider_select_impl(&state, id).await.unwrap_err();

        assert!(err.contains("provider is not connected"));
        assert_ne!(state.runtime_snapshot().config_id, Some(id));
        assert_ne!(state.runtime_snapshot().kind, ProviderKind::Codex);
    }

    #[tokio::test]
    async fn provider_select_swaps_api_key_runtime_and_marks_active() {
        let state = mk_state();
        let id = {
            let db = state.db.lock().unwrap();
            provider_dao::insert(
                db.conn(),
                &NewProviderConfig {
                    kind: "openai".into(),
                    auth_type: "api_key".into(),
                    base_url: None,
                    config: json!({ "selected_model": "gpt-5.4" }),
                },
            )
            .unwrap()
        };
        auth::upsert_provider_api_key(state.keyring.as_ref(), id, "sk-test").unwrap();

        let selected = provider_select_impl(&state, id).await.unwrap();

        assert!(selected.is_active);
        assert_eq!(state.runtime_snapshot().config_id, Some(id));
        assert_eq!(state.runtime_snapshot().kind, ProviderKind::OpenAi);
        let rows = provider_list_impl(&state).unwrap();
        assert!(rows.iter().find(|row| row.id == id).unwrap().is_active);
    }

    #[tokio::test]
    async fn provider_select_swaps_codex_oauth_runtime() {
        let state = mk_state();
        let id = {
            let db = state.db.lock().unwrap();
            provider_dao::insert(
                db.conn(),
                &NewProviderConfig {
                    kind: "codex".into(),
                    auth_type: "oauth".into(),
                    base_url: None,
                    config: json!({
                        "selected_model": "gpt-5.5-codex",
                        "oauth_connected": true,
                        "account_id": "acct_codex_select",
                    }),
                },
            )
            .unwrap()
        };
        auth::store_codex_tokens(
            state.keyring.as_ref(),
            id,
            &auth::CodexTokens {
                access_token: "at".into(),
                refresh_token: "rt".into(),
                id_token: encode_id_token("acct_codex_select"),
                account_id: "acct_codex_select".into(),
                expires_in: 3600,
            },
        )
        .unwrap();

        let selected = provider_select_impl(&state, id).await.unwrap();

        assert!(selected.is_active);
        assert_eq!(selected.account_id.as_deref(), Some("acct_codex_select"));
        assert_eq!(state.runtime_snapshot().config_id, Some(id));
        assert_eq!(state.runtime_snapshot().kind, ProviderKind::Codex);
    }

    #[test]
    fn provider_list_normalizes_retired_opencode_zen_model() {
        let state = mk_state();
        let id = {
            let db = state.db.lock().unwrap();
            provider_dao::insert(
                db.conn(),
                &NewProviderConfig {
                    kind: "opencode_zen".into(),
                    auth_type: "api_key".into(),
                    base_url: None,
                    config: json!({ "selected_model": "gpt-5-nano" }),
                },
            )
            .unwrap()
        };

        let rows = provider_list_impl(&state).unwrap();
        let opencode = rows.iter().find(|row| row.id == id).unwrap();
        assert_eq!(opencode.selected_model.as_deref(), Some("big-pickle"));
        let db = state.db.lock().unwrap();
        let repaired = provider_dao::read_selected_model(db.conn(), id).unwrap();
        assert_eq!(repaired.as_deref(), Some("big-pickle"));
    }

    #[tokio::test]
    async fn provider_set_model_rejects_unsupported_opencode_model_with_cta() {
        let state = mk_state();
        let id = {
            let db = state.db.lock().unwrap();
            provider_dao::insert(
                db.conn(),
                &NewProviderConfig {
                    kind: "opencode_zen".into(),
                    auth_type: "api_key".into(),
                    base_url: None,
                    config: json!({ "selected_model": "big-pickle" }),
                },
            )
            .unwrap()
        };

        let err = provider_set_model_impl(&state, id, "ling-2.6-flash".into())
            .await
            .unwrap_err();
        assert!(err.contains("ling-2.6-flash"));
        assert!(err.contains("Settings"));
    }

    #[test]
    fn provider_list_requires_api_key_secret_to_be_connected() {
        let state = mk_state();
        let id = {
            let db = state.db.lock().unwrap();
            provider_dao::insert(
                db.conn(),
                &NewProviderConfig {
                    kind: "opencode_zen".into(),
                    auth_type: "api_key".into(),
                    base_url: None,
                    config: json!({ "selected_model": "minimax-m2.5-free" }),
                },
            )
            .unwrap()
        };

        let rows = provider_list_impl(&state).unwrap();
        let opencode = rows.iter().find(|row| row.id == id).unwrap();
        assert!(!opencode.is_connected);

        auth::upsert_provider_api_key(state.keyring.as_ref(), id, "sk-test").unwrap();
        let rows = provider_list_impl(&state).unwrap();
        let opencode = rows.iter().find(|row| row.id == id).unwrap();
        assert!(opencode.is_connected);
    }

    #[test]
    fn provider_list_command_path_requires_api_key_secret_to_be_connected() {
        let state = mk_state();
        let id = {
            let db = state.db.lock().unwrap();
            provider_dao::insert(
                db.conn(),
                &NewProviderConfig {
                    kind: "openai".into(),
                    auth_type: "api_key".into(),
                    base_url: None,
                    config: json!({ "selected_model": "gpt-5.1" }),
                },
            )
            .unwrap()
        };

        let rows = provider_list_command_impl(&state).unwrap();
        let openai = rows.iter().find(|row| row.id == id).unwrap();
        assert!(!openai.is_connected);

        auth::upsert_provider_api_key(state.keyring.as_ref(), id, "sk-test").unwrap();
        let rows = provider_list_command_impl(&state).unwrap();
        let openai = rows.iter().find(|row| row.id == id).unwrap();
        assert!(openai.is_connected);
    }

    #[tokio::test]
    async fn connect_health_checks_before_persisting_and_swaps_runtime() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/models"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": []
            })))
            .mount(&server)
            .await;

        let state = mk_state();
        let summary = provider_connect_impl(
            &state,
            "openai".into(),
            "sk-test".into(),
            Some(server.uri()),
        )
        .await
        .unwrap();

        assert!(summary.is_connected);
        assert_eq!(state.runtime_snapshot().config_id, Some(summary.id));
        assert_eq!(
            state.runtime_snapshot().kind,
            crate::ipc::ProviderKind::OpenAi
        );
        assert!(
            auth::load_provider_api_key(state.keyring.as_ref(), summary.id)
                .unwrap()
                .is_some()
        );
    }

    #[tokio::test]
    async fn connect_canonicalizes_opencode_zen_kind() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/models"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": []
            })))
            .mount(&server)
            .await;

        let state = mk_state();
        let summary = provider_connect_impl(
            &state,
            "opencode-zen".into(),
            "sk-test".into(),
            Some(server.uri()),
        )
        .await
        .unwrap();

        assert_eq!(summary.kind, "opencode_zen");
        assert_eq!(
            state.runtime_snapshot().kind,
            crate::ipc::ProviderKind::OpencodeZen
        );
        assert_eq!(state.runtime_snapshot().kind.as_str(), "opencode_zen");
        let db = state.db.lock().unwrap();
        let rows = provider_dao::list(db.conn()).unwrap();
        assert_eq!(rows[0].kind, "opencode_zen");
    }

    #[tokio::test]
    async fn provider_select_runtime_swaps_to_existing_connected_provider() {
        let state = mk_state();
        let id = {
            let db = state.db.lock().unwrap();
            provider_dao::insert(
                db.conn(),
                &NewProviderConfig {
                    kind: "openai".into(),
                    auth_type: "api_key".into(),
                    base_url: None,
                    config: json!({ "selected_model": "gpt-5.4" }),
                },
            )
            .unwrap()
        };
        auth::upsert_provider_api_key(state.keyring.as_ref(), id, "sk-test").unwrap();

        let summary = provider_select_runtime_impl(&state, id).await.unwrap();

        assert_eq!(summary.id, id);
        assert!(summary.is_active);
        assert_eq!(summary.selected_model.as_deref(), Some("gpt-5.4"));
        assert_eq!(state.runtime_snapshot().config_id, Some(id));
        assert_eq!(state.runtime_snapshot().kind, ProviderKind::OpenAi);
        assert_eq!(state.runtime_snapshot().model, "gpt-5.4");
    }

    #[tokio::test]
    async fn provider_set_model_switches_runtime_even_when_provider_was_inactive() {
        let state = mk_state();
        let id = {
            let db = state.db.lock().unwrap();
            provider_dao::insert(
                db.conn(),
                &NewProviderConfig {
                    kind: "openrouter".into(),
                    auth_type: "api_key".into(),
                    base_url: None,
                    config: json!({ "selected_model": "openai/gpt-5.4-mini" }),
                },
            )
            .unwrap()
        };
        auth::upsert_provider_api_key(state.keyring.as_ref(), id, "sk-test").unwrap();
        state
            .swap_runtime(ProviderRuntime::new(
                Some(999),
                ProviderKind::OpenAi,
                "gpt-5.4-mini".into(),
                Arc::new(MockProvider::new(Vec::new())),
            ))
            .unwrap();

        provider_set_model_impl(&state, id, "openai/gpt-5.4".into())
            .await
            .unwrap();

        assert_eq!(state.runtime_snapshot().config_id, Some(id));
        assert_eq!(state.runtime_snapshot().kind, ProviderKind::OpenRouter);
        assert_eq!(state.runtime_snapshot().model, "openai/gpt-5.4");
    }

    #[tokio::test]
    async fn connect_auth_failure_does_not_persist() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/models"))
            .respond_with(ResponseTemplate::new(401).set_body_string("bad key"))
            .mount(&server)
            .await;

        let state = mk_state();
        let err =
            provider_connect_impl(&state, "openai".into(), "sk-bad".into(), Some(server.uri()))
                .await
                .unwrap_err();

        assert!(err.contains("api error (401)"));
        let db = state.db.lock().unwrap();
        assert!(provider_dao::list(db.conn()).unwrap().is_empty());
        drop(db);
        assert!(state.runtime_snapshot().config_id.is_none());
    }
}
