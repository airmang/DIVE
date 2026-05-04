use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::auth;
use crate::db::dao::provider_config as provider_dao;
use crate::db::models::{NewProviderConfig, ProviderConfigRow};

use super::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfigSummary {
    pub id: i64,
    pub kind: String,
    pub auth_type: String,
    pub base_url: Option<String>,
    pub is_connected: bool,
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
                config: Value::Object(serde_json::Map::new()),
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
            model,
            provider,
        ))
        .map_err(|e| format!("runtime: {e}"))?;
    Ok(ProviderConfigSummary {
        id,
        kind: canonical_kind,
        auth_type: "api_key".into(),
        base_url,
        is_connected: true,
    })
}

#[tauri::command]
pub async fn provider_list(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderConfigSummary>, String> {
    let rows: Vec<ProviderConfigRow> = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        provider_dao::list(db.conn()).map_err(|e| e.to_string())?
    };
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let is_connected = auth::load_provider_api_key(state.keyring.as_ref(), row.id)
            .map(|s| s.is_some())
            .unwrap_or(false);
        out.push(ProviderConfigSummary {
            id: row.id,
            kind: row.kind,
            auth_type: row.auth_type,
            base_url: row.base_url,
            is_connected,
        });
    }
    Ok(out)
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
    auth::delete_provider_api_key(state.keyring.as_ref(), provider_config_id)
        .map_err(|e| format!("keyring: {e}"))?;
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
