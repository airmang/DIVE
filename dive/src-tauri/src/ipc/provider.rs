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
    let trimmed_key = api_key.trim();
    if trimmed_key.is_empty() {
        return Err("api_key cannot be empty".into());
    }
    let id = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        provider_dao::insert(
            db.conn(),
            &NewProviderConfig {
                kind: kind.clone(),
                auth_type: "api_key".into(),
                base_url: base_url.clone(),
                config: Value::Object(serde_json::Map::new()),
            },
        )
        .map_err(|e| e.to_string())?
    };
    auth::upsert_provider_api_key(state.keyring.as_ref(), id, trimmed_key)
        .map_err(|e| format!("keyring: {e}"))?;
    Ok(ProviderConfigSummary {
        id,
        kind,
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
    auth::delete_provider_api_key(state.keyring.as_ref(), provider_config_id)
        .map_err(|e| format!("keyring: {e}"))?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    provider_dao::delete(db.conn(), provider_config_id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::InMemoryKeyring;
    use crate::db::Database;
    use crate::providers::MockProvider;
    use std::sync::Arc;

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
}
