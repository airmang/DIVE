use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::auth;
use crate::db::dao::provider_config as provider_dao;
use crate::db::models::{NewProviderConfig, ProviderConfigRow};
use crate::providers::ModelInfo;

use super::{AppState, ProviderKind, ProviderRuntime};

fn selected_model_from_config(config: &Value) -> Option<String> {
    config
        .get("selected_model")
        .or_else(|| config.get("model"))
        .and_then(|value| value.as_str())
        .map(str::to_owned)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfigSummary {
    pub id: i64,
    pub kind: String,
    pub auth_type: String,
    pub base_url: Option<String>,
    pub is_connected: bool,
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
    crate::providers::health_check(&kind, trimmed_key, base_url.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    let provider = crate::providers::build_provider(&kind, trimmed_key, base_url.as_deref())
        .map_err(|e| e.to_string())?;
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
    Ok(ProviderConfigSummary {
        id,
        kind: canonical_kind,
        auth_type: "api_key".into(),
        base_url,
        is_connected: true,
        selected_model: Some(model),
        account_id: None,
    })
}

#[tauri::command]
pub async fn provider_list(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderConfigSummary>, String> {
    provider_list_impl(&state)
}

pub fn provider_list_impl(state: &AppState) -> Result<Vec<ProviderConfigSummary>, String> {
    let rows: Vec<ProviderConfigRow> = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        provider_dao::list(db.conn()).map_err(|e| e.to_string())?
    };
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let selected_model = selected_model_from_config(&row.config);
        let (is_connected, account_id) =
            connection_summary(state.keyring.as_ref(), row.id, &row.kind);
        out.push(ProviderConfigSummary {
            id: row.id,
            kind: row.kind,
            auth_type: row.auth_type,
            base_url: row.base_url,
            is_connected,
            selected_model,
            account_id,
        });
    }
    Ok(out)
}

fn connection_summary(
    keyring: &dyn auth::Keyring,
    provider_config_id: i64,
    kind: &str,
) -> (bool, Option<String>) {
    if kind == "codex" {
        let Ok(Some((_access, _refresh, id_token))) =
            auth::load_codex_tokens(keyring, provider_config_id)
        else {
            return (false, None);
        };
        let account_id = if id_token.is_empty() {
            None
        } else {
            auth::codex_oauth::decode_account_id(&id_token).ok()
        };
        return (true, account_id);
    }
    let is_connected = auth::load_provider_api_key(keyring, provider_config_id)
        .map(|s| s.is_some())
        .unwrap_or(false);
    (is_connected, None)
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
        let allowed = crate::providers::models_for_kind(&row.kind);
        if !allowed.is_empty() && !allowed.iter().any(|model| model.id == trimmed) {
            return Err(format!("model not available for {}: {trimmed}", row.kind));
        }
        provider_dao::write_selected_model(db.conn(), provider_id, &trimmed)
            .map_err(|e| e.to_string())?;
        row
    };

    let snap = state.runtime_snapshot();
    if snap.config_id == Some(provider_id) {
        state
            .swap_runtime(ProviderRuntime::new(
                Some(provider_id),
                ProviderKind::parse(&row.kind),
                trimmed,
                snap.provider,
            ))
            .map_err(|e| format!("runtime: {e}"))?;
    }
    Ok(())
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
                    config: json!({ "selected_model": "gpt-5.5-codex" }),
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

        let rows = provider_list_impl(&state).unwrap();
        let codex = rows.iter().find(|row| row.id == id).unwrap();
        assert!(codex.is_connected);
        assert_eq!(
            codex.account_id.as_deref(),
            Some("acct_codex_provider_list")
        );
        assert_eq!(codex.selected_model.as_deref(), Some("gpt-5.5-codex"));
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
