use serde::{Deserialize, Serialize};
use tauri::State;

use super::AppState;
use crate::mcp::{dao as mcp_dao, InitializeResult, McpServerRegistry, McpToolInfo, NewMcpServer};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerInput {
    pub label: String,
    pub transport: String,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Option<serde_json::Value>,
    #[serde(default)]
    pub env: Option<serde_json::Value>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: Option<serde_json::Value>,
    #[serde(default = "default_risk")]
    pub default_risk: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_risk() -> String {
    "caution".into()
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpConnectResult {
    pub initialize: InitializeResult,
    pub tools: Vec<McpToolInfo>,
}

#[tauri::command]
pub async fn mcp_server_add(
    state: State<'_, AppState>,
    server: McpServerInput,
) -> Result<i64, String> {
    let new = NewMcpServer {
        label: server.label,
        transport: server.transport,
        command: server.command,
        args: server.args,
        env: server.env,
        url: server.url,
        headers: server.headers,
        default_risk: server.default_risk,
        enabled: server.enabled,
    };
    let db = state.db.lock().map_err(|e| e.to_string())?;
    mcp_dao::insert(db.conn(), &new).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_server_list(
    state: State<'_, AppState>,
) -> Result<Vec<mcp_dao::McpServerRow>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    mcp_dao::list(db.conn()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_server_remove(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    mcp_dao::delete(db.conn(), id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_server_set_enabled(
    state: State<'_, AppState>,
    id: i64,
    enabled: bool,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    mcp_dao::set_enabled(db.conn(), id, enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_server_test_connect(
    state: State<'_, AppState>,
    id: i64,
) -> Result<McpConnectResult, String> {
    let row = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        mcp_dao::get(db.conn(), id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("mcp server {id} not found"))?
    };
    let (_client, init, tools) = McpServerRegistry::connect_and_initialize(&row)
        .await
        .map_err(|e| e.to_string())?;
    Ok(McpConnectResult {
        initialize: init,
        tools,
    })
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

    #[tokio::test]
    async fn add_list_remove_cycle() {
        let state = mk_state();
        let id = {
            let db = state.db.lock().unwrap();
            mcp_dao::insert(
                db.conn(),
                &NewMcpServer {
                    label: "fs".into(),
                    transport: "stdio".into(),
                    command: Some("cat".into()),
                    default_risk: "caution".into(),
                    enabled: true,
                    ..Default::default()
                },
            )
            .unwrap()
        };
        let db = state.db.lock().unwrap();
        let rows = mcp_dao::list(db.conn()).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, id);
        assert_eq!(rows[0].label, "fs");
        drop(db);

        let db = state.db.lock().unwrap();
        mcp_dao::delete(db.conn(), id).unwrap();
        assert_eq!(mcp_dao::list(db.conn()).unwrap().len(), 0);
    }
}
